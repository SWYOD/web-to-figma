import { PROTOCOL_VERSION, RECONNECT_DELAYS_MS, REQUEST_TIMEOUT_MS } from './constants.js'
import { createMessage, encodeBridgeMessage, parseBridgeMessage } from './codec.js'
import type { BridgeMessage, BridgeMessageKind } from './messages.js'

export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected'

export interface BridgeClientOptions {
  url: string
  token: string
  clientVersion: string
  /** Позволяет тестировать/подменять транспорт; по умолчанию — глобальный browser WebSocket. */
  WebSocketImpl?: typeof WebSocket
  onStateChange?: (state: BridgeConnectionState) => void
  onMessage?: (message: BridgeMessage) => void
  onAuthFailed?: (reason: 'AUTH_FAILED' | 'VERSION_UNSUPPORTED') => void
}

interface PendingRequest {
  resolve: (message: BridgeMessage) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * Клиентская сторона моста — используется UI Figma Plugin (iframe с обычным
 * browser WebSocket). Desktop-приложение — сервер, см. server.ts.
 */
export class BridgeClient {
  private ws: WebSocket | null = null
  private state: BridgeConnectionState = 'disconnected'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly options: BridgeClientOptions) {}

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

  getState(): BridgeConnectionState {
    return this.state
  }

  send(message: BridgeMessage): void {
    if (this.ws?.readyState !== 1 /* OPEN */) return
    this.ws.send(encodeBridgeMessage(message))
  }

  /** Отправляет запрос и ждёт `response`/`error` с этим же `requestId`. */
  request<T extends BridgeMessage>(kind: T['kind'], payload: T['payload']): Promise<BridgeMessage> {
    const message = createMessage(kind, payload)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error(`Bridge request "${kind}" timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(message.id, { resolve, reject, timeout })
      this.send(message)
    })
  }

  private openSocket(): void {
    this.setState('connecting')
    const Impl = this.options.WebSocketImpl ?? WebSocket
    const ws = new Impl(this.options.url)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.send(
        createMessage('hello', {
          token: this.options.token,
          client: 'figma-plugin',
          clientVersion: this.options.clientVersion
        })
      )
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      const parsed = parseBridgeMessage(raw)
      if (!parsed.ok) return
      this.handleMessage(parsed.message)
    })

    ws.addEventListener('close', () => {
      if (this.state === 'connected' || this.state === 'connecting') this.setState('disconnected')
      if (!this.closedByUser) this.scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      // 'close' всегда следует за 'error' в WebSocket — переподключение планируется там.
    })
  }

  private handleMessage(message: BridgeMessage): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) return

    if (message.kind === 'hello-ack') {
      this.reconnectAttempt = 0
      this.setState('connected')
    } else if (message.kind === 'hello-reject') {
      this.options.onAuthFailed?.(message.payload.reason)
      this.closedByUser = true
      this.ws?.close()
      return
    } else if (message.kind === 'ping') {
      this.send({ protocolVersion: PROTOCOL_VERSION, id: message.id, kind: 'pong', requestId: message.id, payload: {} })
    }

    const requestId = 'requestId' in message ? message.requestId : undefined
    if (requestId && this.pending.has(requestId)) {
      const p = this.pending.get(requestId)!
      clearTimeout(p.timeout)
      this.pending.delete(requestId)
      p.resolve(message)
    }

    this.options.onMessage?.(message)
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  private setState(state: BridgeConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.options.onStateChange?.(state)
  }
}

export type { BridgeMessageKind }
