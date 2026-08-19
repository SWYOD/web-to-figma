import { useEffect, useRef, useState } from 'react'
import { BridgeClient, DEFAULT_PORT, type BridgeConnectionState } from '@web-to-figma/bridge-protocol'
import { StatusRow, ThemeProvider, ToolbarButton } from '@web-to-figma/ui'

const PLUGIN_VERSION = '0.1.0'

type MainToUiMessage = { type: 'stored-token'; token: string | null }

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

function Plugin(): JSX.Element {
  const [token, setToken] = useState<string | null | 'loading'>('loading')
  const [port, setPort] = useState(String(DEFAULT_PORT))
  const [tokenInput, setTokenInput] = useState('')
  const [state, setState] = useState<BridgeConnectionState>('disconnected')
  const [authError, setAuthError] = useState<string | null>(null)
  const clientRef = useRef<BridgeClient | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const msg = event.data?.pluginMessage as MainToUiMessage | undefined
      if (msg?.type === 'stored-token') setToken(msg.token)
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
      onAuthFailed: (reason) => setAuthError(reason)
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
        <div className="plugin-hint">Selected:</div>
        <div className="selected-tag">— (Element picker появится в Phase 3)</div>
      </div>
      <div className="plugin-section plugin-actions">
        <ToolbarButton primary disabled>
          Import
        </ToolbarButton>
        <div className="plugin-hint">Импорт станет доступен вместе с Design AST/renderer (Phase 5-6).</div>
      </div>
    </>
  )
}
