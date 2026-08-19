import { useEffect, useRef, useState } from 'react'
import {
  BridgeClient,
  createResponse,
  DEFAULT_PORT,
  type BridgeConnectionState,
  type ErrorMessage,
  type ResponseMessage
} from '@web-to-figma/bridge-protocol'
import { StatusRow, ThemeProvider, ToolbarButton } from '@web-to-figma/ui'
import type { DesignDocument } from '@web-to-figma/design-ast'

const PLUGIN_VERSION = '0.1.0'

type MainToUiMessage =
  | { type: 'stored-token'; token: string | null }
  | { type: 'import-result'; requestId: string; ok: true; nodeId: string }
  | { type: 'import-result'; requestId: string; ok: false; error: string }

function postToMain(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*')
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
  const [token, setToken] = useState<string | null | 'loading'>('loading')
  const [port, setPort] = useState(String(DEFAULT_PORT))
  const [tokenInput, setTokenInput] = useState('')
  const [state, setState] = useState<BridgeConnectionState>('disconnected')
  const [authError, setAuthError] = useState<string | null>(null)
  const [lastImport, setLastImport] = useState<LastImport | null>(null)
  const clientRef = useRef<BridgeClient | null>(null)

  // Main sandbox → UI: результат импорта, привязанный к mainMessage listener ниже.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const msg = event.data?.pluginMessage as MainToUiMessage | undefined
      if (!msg) return
      if (msg.type === 'stored-token') {
        setToken(msg.token)
      } else if (msg.type === 'import-result') {
        setLastImport(msg.ok ? { ok: true, detail: msg.nodeId } : { ok: false, detail: msg.error })
        if (msg.ok) {
          clientRef.current?.send(createResponse<ResponseMessage>('response', msg.requestId, { nodeId: msg.nodeId }))
        } else {
          clientRef.current?.send(
            createResponse<ErrorMessage>('error', msg.requestId, { code: 'IMPORT_FAILED', message: msg.error })
          )
        }
      }
    }
    window.addEventListener('message', onMessage)
    postToMain({ type: 'get-stored-token' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!token || token === 'loading') return
    connect(token, Number(port))
    return () => clientRef.current?.disconnect()
    // Подключаемся заново только по смене токена — правки поля "Порт" применяются явной кнопкой, не на каждый keystroke.
  }, [token])

  function connect(activeToken: string, activePort: number): void {
    clientRef.current?.disconnect()
    const client = new BridgeClient({
      url: `ws://127.0.0.1:${activePort}`,
      token: activeToken,
      clientVersion: PLUGIN_VERSION,
      onStateChange: setState,
      onAuthFailed: (reason) => setAuthError(reason),
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
  }

  const savePairing = (): void => {
    const value = tokenInput.trim()
    if (!value) return
    postToMain({ type: 'save-token', token: value })
    setToken(value)
  }

  if (token === 'loading') return <div className="plugin-hint">Загрузка…</div>

  if (!token || authError === 'AUTH_FAILED') {
    return (
      <div className="plugin-section">
        <div className="plugin-title">Web Importer</div>
        {authError === 'AUTH_FAILED' && (
          <div className="plugin-hint" style={{ color: 'var(--danger)' }}>
            Код не подошёл — проверьте код в desktop-приложении и попробуйте снова.
          </div>
        )}
        <div className="plugin-hint">
          Вставьте код подключения из desktop-приложения Web → Figma (Toolbar → Bridge).
        </div>
        <input
          className="text-input"
          placeholder="Код подключения"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && savePairing()}
        />
        <input className="text-input" placeholder="Порт" value={port} onChange={(e) => setPort(e.target.value)} />
        <ToolbarButton primary onClick={savePairing}>
          Подключиться
        </ToolbarButton>
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
