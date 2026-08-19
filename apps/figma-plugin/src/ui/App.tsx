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

const PLUGIN_VERSION = '0.1.0'
const DISCOVERY_TIMEOUT_MS = 1200
const DISCOVERY_RETRY_MS = 2500

type MainToUiMessage =
  | { type: 'import-result'; requestId: string; ok: true; nodeId: string }
  | { type: 'import-result'; requestId: string; ok: false; error: string }

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
      const res = await fetch(`http://127.0.0.1:${port}/pairing`, { signal: controller.signal })
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

function Plugin(): JSX.Element {
  const [pairing, setPairing] = useState<Pairing | 'searching'>('searching')
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<BridgeConnectionState>('disconnected')
  const [authError, setAuthError] = useState<'AUTH_FAILED' | 'VERSION_UNSUPPORTED' | null>(null)
  const [lastImport, setLastImport] = useState<LastImport | null>(null)
  const clientRef = useRef<BridgeClient | null>(null)

  // Main sandbox → UI: результат импорта.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const msg = event.data?.pluginMessage as MainToUiMessage | undefined
      if (!msg || msg.type !== 'import-result') return
      setLastImport(msg.ok ? { ok: true, detail: msg.nodeId } : { ok: false, detail: msg.error })
      if (msg.ok) {
        clientRef.current?.send(createResponse<ResponseMessage>('response', msg.requestId, { nodeId: msg.nodeId }))
      } else {
        clientRef.current?.send(createResponse<ErrorMessage>('error', msg.requestId, { code: 'IMPORT_FAILED', message: msg.error }))
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
      url: `ws://127.0.0.1:${pairing.port}`,
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
        // ImportNodeMessage инициирует desktop (не запрос этого клиента) — main
        // sandbox — единственное место с доступом к figma.*, поэтому релеим.
        if (message.kind === 'import-node') {
          postToMain({ type: 'import-node', requestId: message.id, document: message.payload.document as DesignDocument, as: message.payload.as })
        }
      }
    })
    clientRef.current = client
    setAuthError(null)
    client.connect()
    return () => client.disconnect()
  }, [pairing])

  if (pairing === 'searching') {
    return (
      <div className="plugin-section">
        <div className="plugin-title">Web Importer</div>
        <StatusRow state="connecting">Ищем приложение Web To Figma…</StatusRow>
        <div className="plugin-hint">Откройте desktop-приложение Web To Figma — плагин подключится сам.</div>
      </div>
    )
  }

  if (authError === 'VERSION_UNSUPPORTED') {
    return (
      <div className="plugin-section">
        <div className="plugin-title">Web Importer</div>
        <div className="plugin-hint" style={{ color: 'var(--danger)' }}>
          Версия плагина не совместима с desktop-приложением — обновите одно из них.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="plugin-section">
        <div className="plugin-title">Web Importer</div>
        <StatusRow state={state}>
          {state === 'connected' ? 'Desktop bridge connected' : state === 'connecting' ? 'Подключение…' : 'Desktop bridge отключён'}
        </StatusRow>
      </div>
      <div className="plugin-section">
        <div className="plugin-hint">
          Выбор элемента и импорт запускаются из desktop-приложения (Inspector → Select element →
          Import as Frame).
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
    </>
  )
}
