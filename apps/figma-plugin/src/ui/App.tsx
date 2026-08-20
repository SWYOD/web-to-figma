import { useEffect, useRef, useState } from 'react'
import {
  BridgeClient,
  createResponse,
  DEFAULT_PORT,
  PORT_FALLBACK_RANGE,
  type BridgeConnectionState,
  type ErrorMessage,
  type ResponseMessage
} from '@web-to-figma/bridge-protocol'
import { StatusRow, ThemeProvider } from '@web-to-figma/ui'
import type { DesignDocument } from '@web-to-figma/design-ast'
import { DesignAgentClient, type DesignAgentState } from './designAgentClient'

const PLUGIN_VERSION = '0.1.0'
const DISCOVERY_TIMEOUT_MS = 1200
const DISCOVERY_RETRY_MS = 2500

type MainToUiMessage =
  | { type: 'import-result'; requestId: string; ok: true; nodeId: string }
  | { type: 'import-result'; requestId: string; ok: false; error: string }
  | { type: 'apply-result'; requestId: string; ok: true; appliedTo: number; skipped: string[] }
  | { type: 'apply-result'; requestId: string; ok: false; error: string }
  | { type: 'place-asset-result'; requestId: string; ok: true; nodeId: string }
  | { type: 'place-asset-result'; requestId: string; ok: false; error: string }
  | { type: 'da-result'; id: string; ok: true; result: unknown }
  | { type: 'da-result'; id: string; ok: false; error: string }

function postToMain(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*')
}

interface Pairing {
  token: string
  port: number
}

/**
 * Опрашивает `/pairing` (см. `packages/bridge-protocol/src/server.ts`) на
 * каждом порту диапазона fallback параллельно — тот же диапазон, что desktop
 * перебирает при старте (`constants.ts`). Раньше пользователь копировал этот
 * токен вручную из desktop-приложения в это поле — теперь плагин добывает
 * его сам, как у "DesignAgent"-подобных мостов: плагин сам ищет запущенный
 * локальный хост, а не ждёт participation пользователя.
 */
async function discoverPairing(): Promise<Pairing | null> {
  const ports = Array.from({ length: PORT_FALLBACK_RANGE + 1 }, (_, i) => DEFAULT_PORT + i)
  const attempts = ports.map(async (port): Promise<Pairing> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
    try {
      // localhost, не 127.0.0.1 — Figma manifest's networkAccess.allowedDomains
      // не проходит IP-литералы валидацией ("must be a valid URL"), только
      // доменные имена/localhost (см. manifest.json reasoning).
      const res = await fetch(`http://localhost:${port}/pairing`, { signal: controller.signal })
      if (!res.ok) throw new Error('not ok')
      const data = (await res.json()) as { token?: unknown }
      if (typeof data.token !== 'string') throw new Error('bad payload')
      return { token: data.token, port }
    } finally {
      clearTimeout(timeout)
    }
  })

  const results = await Promise.allSettled(attempts)
  const found = results.find((r): r is PromiseFulfilledResult<Pairing> => r.status === 'fulfilled')
  return found?.value ?? null
}

export default function App(): JSX.Element {
  return (
    <ThemeProvider mode="system" onModeChange={() => {}}>
      <Plugin />
    </ThemeProvider>
  )
}

interface LastImport {
  ok: boolean
  detail: string
}

interface LastApply {
  ok: boolean
  detail: string
}

function Plugin(): JSX.Element {
  const [pairing, setPairing] = useState<Pairing | 'searching'>('searching')
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<BridgeConnectionState>('disconnected')
  const [authError, setAuthError] = useState<'AUTH_FAILED' | 'VERSION_UNSUPPORTED' | null>(null)
  const [lastImport, setLastImport] = useState<LastImport | null>(null)
  const [lastApply, setLastApply] = useState<LastApply | null>(null)
  const clientRef = useRef<BridgeClient | null>(null)

  // Design Agent bridge (по запросу пользователя) — независимый от desktop
  // bridge канал: см. designAgentClient.ts. daEnabled — пользовательский
  // тумблер ("Start"/"Stop", как в самом плагине DesignAgent).
  const [daEnabled, setDaEnabled] = useState(false)
  const [daState, setDaState] = useState<DesignAgentState>('disconnected')
  const daClientRef = useRef<DesignAgentClient | null>(null)
  const daPendingRef = useRef(new Map<string, (outcome: { ok: boolean; result?: unknown; error?: string }) => void>())
  const daNextIdRef = useRef(0)

  // Main sandbox → UI: результат импорта/apply-styles.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const msg = event.data?.pluginMessage as MainToUiMessage | undefined
      if (!msg) return
      if (msg.type === 'import-result') {
        setLastImport(msg.ok ? { ok: true, detail: msg.nodeId } : { ok: false, detail: msg.error })
        if (msg.ok) {
          clientRef.current?.send(createResponse<ResponseMessage>('response', msg.requestId, { nodeId: msg.nodeId }))
        } else {
          clientRef.current?.send(createResponse<ErrorMessage>('error', msg.requestId, { code: 'IMPORT_FAILED', message: msg.error }))
        }
      } else if (msg.type === 'apply-result') {
        if (msg.ok) {
          const detail =
            msg.skipped.length > 0
              ? `Применено к ${msg.appliedTo} слоям, пропущено: ${msg.skipped.join('; ')}`
              : `Применено к ${msg.appliedTo} слоям`
          setLastApply({ ok: true, detail })
          clientRef.current?.send(
            createResponse<ResponseMessage>('response', msg.requestId, { appliedTo: msg.appliedTo, skipped: msg.skipped })
          )
        } else {
          setLastApply({ ok: false, detail: msg.error })
          clientRef.current?.send(
            createResponse<ErrorMessage>('error', msg.requestId, { code: 'APPLY_STYLES_FAILED', message: msg.error })
          )
        }
      } else if (msg.type === 'place-asset-result') {
        if (msg.ok) {
          clientRef.current?.send(createResponse<ResponseMessage>('response', msg.requestId, { nodeId: msg.nodeId }))
        } else {
          clientRef.current?.send(createResponse<ErrorMessage>('error', msg.requestId, { code: 'PLACE_ASSET_FAILED', message: msg.error }))
        }
      } else if (msg.type === 'da-result') {
        const resolve = daPendingRef.current.get(msg.id)
        if (resolve) {
          daPendingRef.current.delete(msg.id)
          resolve(msg.ok ? { ok: true, result: msg.result } : { ok: false, error: msg.error })
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Автообнаружение desktop-приложения — без ручного ввода кода. Пока не
  // найден — повторяем с интервалом; retryNonce также дёргается ниже после
  // AUTH_FAILED (сервер мог перегенерировать токен между discovery и hello).
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    async function attempt(): Promise<void> {
      const found = await discoverPairing()
      if (cancelled) return
      if (found) {
        setPairing(found)
      } else {
        setPairing('searching')
        retryTimer = setTimeout(attempt, DISCOVERY_RETRY_MS)
      }
    }

    void attempt()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [retryNonce])

  useEffect(() => {
    if (pairing === 'searching') return
    const client = new BridgeClient({
      url: `ws://localhost:${pairing.port}`,
      token: pairing.token,
      clientVersion: PLUGIN_VERSION,
      onStateChange: setState,
      onAuthFailed: (reason) => {
        setAuthError(reason)
        if (reason === 'AUTH_FAILED') {
          setTimeout(() => {
            setPairing('searching')
            setRetryNonce((n) => n + 1)
          }, DISCOVERY_RETRY_MS)
        }
      },
      onMessage: (message) => {
        // ImportNodeMessage/ApplyStylesMessage инициирует desktop (не запрос
        // этого клиента) — main sandbox — единственное место с доступом к
        // figma.*, поэтому релеим.
        if (message.kind === 'import-node') {
          postToMain({
            type: 'import-node',
            requestId: message.id,
            document: message.payload.document as DesignDocument,
            as: message.payload.as,
            useMatchedTextStyles: message.payload.useMatchedTextStyles,
            useMatchedColorStyles: message.payload.useMatchedColorStyles,
            colorMatchSource: message.payload.colorMatchSource
          })
        } else if (message.kind === 'apply-styles') {
          postToMain({
            type: 'apply-styles',
            requestId: message.id,
            document: message.payload.document as DesignDocument,
            targets: message.payload.targets
          })
        } else if (message.kind === 'place-asset') {
          postToMain({
            type: 'place-asset',
            requestId: message.id,
            assetKind: message.payload.assetKind,
            mimeType: message.payload.mimeType,
            width: message.payload.width,
            height: message.payload.height,
            data: message.payload.data
          })
        }
      }
    })
    clientRef.current = client
    setAuthError(null)
    client.connect()
    return () => client.disconnect()
  }, [pairing])

  // Design Agent bridge — только пока daEnabled (пользователь нажал "Start"),
  // независимо от состояния основного desktop bridge выше.
  useEffect(() => {
    if (!daEnabled) return
    const client = new DesignAgentClient({
      onStateChange: setDaState,
      runCommand: (command, params) => {
        const id = String(daNextIdRef.current++)
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            daPendingRef.current.delete(id)
            resolve({ ok: false, error: `Command "${command}" timed out.` })
          }, 20000)
          daPendingRef.current.set(id, (outcome) => {
            clearTimeout(timeout)
            resolve(outcome)
          })
          postToMain({ type: 'da-command', id, command, params })
        })
      }
    })
    daClientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
      daClientRef.current = null
      setDaState('disconnected')
    }
  }, [daEnabled])

  if (pairing === 'searching') {
    return (
      <div className="plugin-section">
        <div className="plugin-title">Web To Figma</div>
        <StatusRow state="connecting">Ищем приложение Web To Figma…</StatusRow>
        <div className="plugin-hint">Откройте desktop-приложение Web To Figma — плагин подключится сам.</div>
      </div>
    )
  }

  if (authError === 'VERSION_UNSUPPORTED') {
    return (
      <div className="plugin-section">
        <div className="plugin-title">Web To Figma</div>
        <div className="plugin-hint" style={{ color: 'var(--danger)' }}>
          Версия плагина не совместима с desktop-приложением — обновите одно из них.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="plugin-section">
        <div className="plugin-title">Web To Figma</div>
        <StatusRow state={state}>
          {state === 'connected' ? 'Desktop bridge connected' : state === 'connecting' ? 'Подключение…' : 'Desktop bridge отключён'}
        </StatusRow>
      </div>
      <div className="plugin-section">
        <div className="plugin-hint">
          Выбор элемента, импорт и Apply to Selection запускаются из desktop-приложения
          (Inspector → Select element → Import as Frame / Apply to Selection).
        </div>
      </div>
      <div className="plugin-section">
        <div className="plugin-title-row">
          <div className="plugin-title">Design Agent</div>
          <button className="da-toggle" onClick={() => setDaEnabled((v) => !v)}>
            {daEnabled ? 'Stop' : 'Start'}
          </button>
        </div>
        {daEnabled && (
          <StatusRow state={daState}>
            {daState === 'connected' ? 'Claude bridge connected' : daState === 'connecting' ? 'Подключение…' : 'Не подключено'}
          </StatusRow>
        )}
        <div className="plugin-hint">
          Параллельный канал к DesignAgent bridge — AI сможет работать с этим файлом Figma, пока вы вручную тащите
          контент через Web To Figma выше. Работает одновременно с обычным bridge.
        </div>
      </div>
      {lastImport && (
        <div className="plugin-section">
          <div className="plugin-hint">Последний импорт:</div>
          <div className={`selected-tag${lastImport.ok ? '' : ' import-error'}`}>
            {lastImport.ok ? `Frame создан (${lastImport.detail})` : lastImport.detail}
          </div>
        </div>
      )}
      {lastApply && (
        <div className="plugin-section">
          <div className="plugin-hint">Последний Apply to Selection:</div>
          <div className={`selected-tag${lastApply.ok ? '' : ' import-error'}`}>{lastApply.detail}</div>
        </div>
      )}
    </>
  )
}
