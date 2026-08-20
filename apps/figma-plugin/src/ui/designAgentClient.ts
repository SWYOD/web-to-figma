/**
 * Клиент к брокеру DesignAgent bridge (`ws://localhost:3790`) — ВТОРОЕ,
 * независимое соединение, параллельное обычному `BridgeClient` к
 * desktop-приложению Web To Figma. По запросу пользователя: он хочет, чтобы
 * AI (через MCP-тулы DesignAgent) мог работать с Figma-канвасом ПАРАЛЛЕЛЬНО
 * с ручным импортом контента через Web To Figma в одном и том же открытом
 * плагине — Figma физически не даёт держать два плагина открытыми
 * одновременно, поэтому вместо запуска отдельного плагина DesignAgent этот
 * плагин сам умеет говорить на его протоколе.
 *
 * Протокол брокера (см. `C:\Users\ilya\.claude\plugins\cache\designagent\
 * designagent\<version>\mcp\src\broker.ts`, полные исходники, не документация
 * "снаружи"): плагин — WebSocket-клиент, а не сервер (порт держит отдельный
 * процесс-брокер). Рукопожатие: `{type:'hello', role:'figma-plugin'}` →
 * `{type:'hello_ack', serverInstanceId, pid}`. Дальше брокер шлёт
 * `{type:'request', id, command, params}` на каждый вызов MCP-тула из Claude
 * — обрабатываем через main sandbox (`designAgentCommands.ts`, у UI iframe
 * нет доступа к figma.*) и отвечаем `{type:'response', id, ok, result|error}`.
 * `{type:'sessions', sessions:[...]}` — информационно, какие Claude-сессии
 * подключены; `{type:'ping'}` — отвечаем `{type:'pong'}`.
 *
 * Reverse-channel (`server_request`/`select_session`) НЕ реализован — ни одна
 * из портированных команд (см. designAgentCommands.ts) не требует
 * файловой системы на стороне Claude/MCP-сервера.
 */

export type DesignAgentState = 'disconnected' | 'connecting' | 'connected'

export interface DesignAgentClientOptions {
  url?: string
  WebSocketImpl?: typeof WebSocket
  onStateChange?: (state: DesignAgentState) => void
  /** Выполняет команду через main sandbox (единственное место с доступом к figma.*). */
  runCommand: (command: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>
}

const DEFAULT_URL = 'ws://localhost:3790'
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

interface BrokerMessage {
  type?: string
  id?: string
  command?: string
  params?: unknown
}

export class DesignAgentClient {
  private ws: WebSocket | null = null
  private state: DesignAgentState = 'disconnected'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = true

  constructor(private readonly options: DesignAgentClientOptions) {}

  connect(): void {
    this.closedByUser = false
    this.openSocket()
  }

  disconnect(): void {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.setState('disconnected')
  }

  getState(): DesignAgentState {
    return this.state
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState !== 1 /* OPEN */) return
    this.ws.send(JSON.stringify(payload))
  }

  private openSocket(): void {
    this.setState('connecting')
    const Impl = this.options.WebSocketImpl ?? WebSocket
    const ws = new Impl(this.options.url ?? DEFAULT_URL)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.send({ type: 'hello', role: 'figma-plugin' })
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      let msg: BrokerMessage
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      void this.handleMessage(msg)
    })

    ws.addEventListener('close', () => {
      if (this.state === 'connected' || this.state === 'connecting') this.setState('disconnected')
      if (!this.closedByUser) this.scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      // 'close' всегда следует за 'error' — переподключение планируется там.
    })
  }

  private async handleMessage(msg: BrokerMessage): Promise<void> {
    if (msg.type === 'hello_ack') {
      this.reconnectAttempt = 0
      this.setState('connected')
      return
    }
    if (msg.type === 'ping') {
      this.send({ type: 'pong' })
      return
    }
    if (msg.type === 'sessions' || msg.type === 'register_ack') {
      // Информационно — список подключённых Claude-сессий, реагировать нечем.
      return
    }
    if (msg.type === 'request' && typeof msg.id === 'string') {
      const command = String(msg.command ?? '')
      const params = msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {}
      const outcome = await this.options.runCommand(command, params)
      this.send({ type: 'response', id: msg.id, ok: outcome.ok, ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }) })
    }
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  private setState(state: DesignAgentState): void {
    if (this.state === state) return
    this.state = state
    this.options.onStateChange?.(state)
  }
}
