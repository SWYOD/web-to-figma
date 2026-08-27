import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  BridgeClient,
  createMessage,
  createResponse,
  DEFAULT_PORT,
  PORT_FALLBACK_RANGE,
  type BridgeConnectionState,
  type ErrorMessage,
  type ResponseMessage,
  type ThemePushMessage,
  type ThemeSyncMessage
} from '@web-to-figma/bridge-protocol'
import { StatusRow, ThemeProvider } from '@web-to-figma/ui'
import type { DesignDocument } from '@web-to-figma/design-ast'
import { DesignAgentClient, type DesignAgentState } from './designAgentClient'
import { CanvasToolkitClient, type CanvasToolkitState } from './canvasToolkitClient'
import { PLUGIN_ICON_DATA_URI } from './pluginIcon'
import { ChevronDown, ChevronUp } from 'lucide-react'

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
  | { type: 'ct-result'; id: string; ok: true; result: unknown }
  | { type: 'ct-result'; id: string; ok: false; error: string }

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

type CompactConnectionState = BridgeConnectionState | 'disabled' | 'error'

function ConnectionBadge({ label, state, title }: { label: string; state: CompactConnectionState; title: string }): JSX.Element {
  return (
    <span className="connection-badge" data-state={state} title={title}>
      <span className="connection-badge-dot" />
      {label}
    </span>
  )
}

function Plugin(): JSX.Element {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('bridge-tools-collapsed') === '1'
    } catch {
      return false
    }
  })
  const [pairing, setPairing] = useState<Pairing | 'searching'>('searching')
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<BridgeConnectionState>('disconnected')
  const [authError, setAuthError] = useState<'AUTH_FAILED' | 'VERSION_UNSUPPORTED' | null>(null)
  const [lastImport, setLastImport] = useState<LastImport | null>(null)
  const [lastApply, setLastApply] = useState<LastApply | null>(null)
  const [syncedTheme, setSyncedTheme] = useState<ThemeSyncMessage['payload'] | null>(null)
  const clientRef = useRef<BridgeClient | null>(null)

  // Design Agent bridge (по запросу пользователя) — независимый от desktop
  // bridge канал: см. designAgentClient.ts. daEnabled — пользовательский
  // тумблер ("Start"/"Stop", как в самом плагине DesignAgent).
  const [daEnabled, setDaEnabled] = useState(false)
  const [daState, setDaState] = useState<DesignAgentState>('disconnected')
  const daClientRef = useRef<DesignAgentClient | null>(null)
  const daPendingRef = useRef(new Map<string, (outcome: { ok: boolean; result?: unknown; error?: string }) => void>())
  const daNextIdRef = useRef(0)

  // Design Toolkit bridge (по запросу пользователя) — ТРЕТИЙ, независимый
  // канал: см. canvasToolkitClient.ts докстринг. Никакого Start/Stop —
  // подключается автоматически, как основной desktop bridge выше, а не
  // вручную, как канал DesignAgent над.
  const [toolkitState, setToolkitState] = useState<CanvasToolkitState>('searching')
  const toolkitClientRef = useRef<CanvasToolkitClient | null>(null)
  const toolkitPendingRef = useRef(new Map<string, (outcome: { ok: boolean; result?: unknown; error?: string }) => void>())
  const toolkitNextIdRef = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem('bridge-tools-collapsed', collapsed ? '1' : '0')
    } catch {
      // Некоторые окружения Figma могут запускать iframe с запрещённым storage;
      // сворачивание всё равно работает в пределах текущей сессии.
    }
    postToMain({ type: 'resize-ui', collapsed })
  }, [collapsed])

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
      } else if (msg.type === 'ct-result') {
        const resolve = toolkitPendingRef.current.get(msg.id)
        if (resolve) {
          toolkitPendingRef.current.delete(msg.id)
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
      onStateChange: (nextState) => {
        setState(nextState)
        if (nextState !== 'connected') setSyncedTheme(null)
      },
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
        if (message.kind === 'theme-sync') {
          setSyncedTheme(message.payload)
          // "Полный синхрон" (по запросу пользователя) — Bridge Tools как узел
          // между Web To Figma и Design Toolkit: тема, пришедшая отсюда,
          // пересылается дальше в Design Toolkit тем же путём, каким сама
          // Design Toolkit присылает свою (см. onThemeSync ниже и
          // canvasToolkitClient.ts pushThemeSync).
          toolkitClientRef.current?.pushThemeSync(message.payload)
        } else if (message.kind === 'import-node') {
          postToMain({
            type: 'import-node',
            requestId: message.id,
            document: message.payload.document as DesignDocument,
            as: message.payload.as,
            useMatchedTextStyles: message.payload.useMatchedTextStyles,
            useMatchedColorStyles: message.payload.useMatchedColorStyles,
            colorMatchSource: message.payload.colorMatchSource,
            placementOffset: message.payload.placementOffset
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

  // Design Toolkit bridge — подключается сразу при монтировании плагина, без
  // пользовательского тумблера (по запросу пользователя), тем же паттерном
  // авто-переподключения, что и основной desktop bridge выше.
  useEffect(() => {
    const client = new CanvasToolkitClient({
      onStateChange: setToolkitState,
      onThemeSync: (payload) => {
        setSyncedTheme(payload)
        // "Полный синхрон", обратное направление — тема от Design Toolkit
        // пересылается в Web To Figma тем же новым theme-push сообщением
        // (см. bridge-protocol messages.ts), которое desktop-приложение
        // применяет как оверлей, не трогая свои settings.json.
        clientRef.current?.send(createMessage<ThemePushMessage>('theme-push', payload))
      },
      runCommand: (command, params) => {
        const id = String(toolkitNextIdRef.current++)
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            toolkitPendingRef.current.delete(id)
            resolve({ ok: false, error: `Command "${command}" timed out.` })
          }, 20000)
          toolkitPendingRef.current.set(id, (outcome) => {
            clearTimeout(timeout)
            resolve(outcome)
          })
          postToMain({ type: 'ct-command', id, command, params })
        })
      }
    })
    toolkitClientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
      toolkitClientRef.current = null
    }
  }, [])

  const desktopBadgeState: CompactConnectionState =
    authError ? 'error' : pairing === 'searching' ? 'connecting' : state
  const desktopBadgeTitle = authError
    ? 'Web To Figma: ошибка совместимости или авторизации'
    : pairing === 'searching'
      ? 'Web To Figma: поиск приложения'
      : `Web To Figma: ${state}`
  const agentBadgeState: CompactConnectionState = daEnabled ? daState : 'disabled'
  const agentBadgeTitle = daEnabled ? `DesignAgent bridge: ${daState}` : 'DesignAgent bridge выключен'
  const toolkitBadgeState: CompactConnectionState = toolkitState === 'searching' ? 'connecting' : toolkitState
  const toolkitBadgeTitle =
    toolkitState === 'searching'
      ? 'Design Toolkit bridge: поиск приложения'
      : `Design Toolkit bridge: ${toolkitState}`
  const syncedThemeStyle = useMemo<CSSProperties | undefined>(() => {
    if (!syncedTheme) return undefined
    const properties: Record<string, string> = { colorScheme: syncedTheme.mode }
    for (const [key, value] of Object.entries(syncedTheme.vars)) properties[`--${key}`] = value
    return properties as CSSProperties
  }, [syncedTheme])

  let desktopContent: JSX.Element
  if (pairing === 'searching') {
    desktopContent = (
      <div className="plugin-section">
        <div className="plugin-title">Web To Figma</div>
        <StatusRow state="connecting">Ищем приложение Web To Figma…</StatusRow>
        <div className="plugin-hint">Откройте desktop-приложение Web To Figma — плагин подключится сам.</div>
      </div>
    )
  } else if (authError === 'VERSION_UNSUPPORTED') {
    desktopContent = (
      <div className="plugin-section">
        <div className="plugin-title">Web To Figma</div>
        <div className="plugin-hint" style={{ color: 'var(--danger)' }}>
          Версия плагина не совместима с desktop-приложением — обновите одно из них.
        </div>
      </div>
    )
  } else {
    desktopContent = (
      <>
        <div className="plugin-section">
          <div className="plugin-title">Web To Figma</div>
          <StatusRow state={state}>
            {state === 'connected'
              ? 'Web To Figma connected'
              : state === 'connecting'
                ? 'Подключение…'
                : 'Web To Figma отключён'}
          </StatusRow>
        </div>
        <div className="plugin-section">
          <div className="plugin-hint">
            Выбор элемента, импорт и Apply to Selection запускаются из desktop-приложения
            (Inspector → Select element → Import as Frame / Apply to Selection).
          </div>
        </div>
      </>
    )
  }

  const content = (
    <>
      {desktopContent}
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
      <div className="plugin-section">
        <div className="plugin-title">Design Toolkit</div>
        <StatusRow state={toolkitState === 'searching' ? 'connecting' : toolkitState}>
          {toolkitState === 'connected'
            ? 'Design Toolkit connected'
            : toolkitState === 'connecting'
              ? 'Подключение…'
              : 'Ищем приложение Design Toolkit…'}
        </StatusRow>
        <div className="plugin-hint">
          Прямая связь с канвасом для инструментов Design Toolkit — подключается сама, откройте приложение Design
          Toolkit на своей машине.
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

  return (
    <div className={`plugin-shell${collapsed ? ' collapsed' : ''}`} style={syncedThemeStyle}>
      <header className="plugin-header">
        <button
          className="plugin-collapse-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Развернуть Bridge Tools' : 'Свернуть Bridge Tools'}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <img className="plugin-header-icon" src={PLUGIN_ICON_DATA_URI} alt="" />
        <div className="plugin-header-title">Bridge Tools</div>
        <div className="connection-badges">
          <ConnectionBadge label="Web to Figma" state={desktopBadgeState} title={desktopBadgeTitle} />
          <ConnectionBadge label="AI" state={agentBadgeState} title={agentBadgeTitle} />
          <ConnectionBadge label="Toolkit" state={toolkitBadgeState} title={toolkitBadgeTitle} />
        </div>
      </header>
      {!collapsed && <main className="plugin-content">{content}</main>}
    </div>
  )
}
