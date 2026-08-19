import { WebSocketServer, type WebSocket as WSSocket } from 'ws'
import { nanoid } from 'nanoid'
import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, PORT_FALLBACK_RANGE, PROTOCOL_VERSION, REQUEST_TIMEOUT_MS } from './constants.js'
import { encodeBridgeMessage, parseBridgeMessage } from './codec.js'
import type { BridgeMessage } from './messages.js'

/**
 * Серверная сторона моста — поднимается в main-процессе Electron
 * (`apps/desktop`). Слушает строго 127.0.0.1, см. docs/bridge-protocol.md.
 * Ничего Electron-специфичного здесь нет: токен и порт передаются снаружи,
 * персистентность (bridge.json) — забота вызывающего кода в apps/desktop.
 */

export interface BridgeServerOptions {
  token: string
  serverVersion: string
  host?: string
  port?: number
  portFallbackRange?: number
  onConnectionCountChange?: (count: number) => void
  onMessage?: (message: BridgeMessage, reply: (message: BridgeMessage) => void) => void
}

interface Peer {
  socket: WSSocket
  sessionId: string
  authenticated: boolean
  pingTimer: ReturnType<typeof setInterval> | null
  pongTimeout: ReturnType<typeof setTimeout> | null
}

interface PendingRequest {
  resolve: (message: BridgeMessage) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class BridgeServer {
  private wss: WebSocketServer | null = null
  private readonly peers = new Set<Peer>()
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly options: BridgeServerOptions) {}

  /**
   * Сообщение, инициированное СЕРВЕРОМ (не ответ на запрос плагина) — напр.
   * `ImportNodeMessage` по клику "Import as Frame" в desktop UI. Рассылается
   * всем аутентифицированным пирам (на практике обычно один — один открытый
   * Figma-файл), резолвится первым пришедшим `response`/`error` с тем же
   * `requestId`. См. docs/bridge-protocol.md §Request/response корреляция.
   */
  request(message: BridgeMessage): Promise<BridgeMessage> {
    return new Promise((resolve, reject) => {
      const authenticated = [...this.peers].filter((p) => p.authenticated)
      if (authenticated.length === 0) {
        reject(new Error('No authenticated bridge peer connected'))
        return
      }
      const timeout = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error(`Bridge request "${message.kind}" timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(message.id, { resolve, reject, timeout })
      for (const peer of authenticated) this.replyTo(peer, message)
    })
  }

  async start(): Promise<{ port: number }> {
    const host = this.options.host ?? '127.0.0.1'
    const startPort = this.options.port ?? 52847
    const range = this.options.portFallbackRange ?? PORT_FALLBACK_RANGE

    for (let attempt = 0; attempt <= range; attempt += 1) {
      const port = startPort + attempt
      try {
        await this.listen(host, port)
        return { port }
      } catch (err) {
        if (!isAddrInUse(err) || attempt === range) throw err
      }
    }
    throw new Error('No available port for bridge server')
  }

  stop(): void {
    for (const peer of this.peers) this.teardownPeer(peer)
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Bridge server stopped'))
      this.pending.delete(id)
    }
    this.wss?.close()
    this.wss = null
  }

  get connectionCount(): number {
    return this.peers.size
  }

  private listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host, port })
      wss.once('error', reject)
      wss.once('listening', () => {
        wss.removeListener('error', reject)
        wss.on('error', () => {
          // Ошибки отдельных соединений не должны валить сервер целиком.
        })
        this.wss = wss
        wss.on('connection', (socket) => this.handleConnection(socket))
        resolve()
      })
    })
  }

  private handleConnection(socket: WSSocket): void {
    const peer: Peer = { socket, sessionId: nanoid(), authenticated: false, pingTimer: null, pongTimeout: null }
    this.peers.add(peer)
    this.options.onConnectionCountChange?.(this.peers.size)

    socket.on('message', (data) => {
      const parsed = parseBridgeMessage(data.toString())
      if (!parsed.ok) return
      this.handleMessage(peer, parsed.message)
    })

    socket.on('close', () => this.teardownPeer(peer))
  }

  private handleMessage(peer: Peer, message: BridgeMessage): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      this.replyTo(peer, {
        protocolVersion: PROTOCOL_VERSION,
        id: nanoid(),
        kind: 'error',
        requestId: message.id,
        payload: { code: 'PROTOCOL_VERSION_MISMATCH', message: 'Unsupported protocol version' }
      })
      return
    }

    if (message.kind === 'hello') {
      if (message.payload.token !== this.options.token) {
        this.replyTo(peer, {
          protocolVersion: PROTOCOL_VERSION,
          id: nanoid(),
          kind: 'hello-reject',
          requestId: message.id,
          payload: { reason: 'AUTH_FAILED' }
        })
        peer.socket.close()
        return
      }
      peer.authenticated = true
      this.replyTo(peer, {
        protocolVersion: PROTOCOL_VERSION,
        id: nanoid(),
        kind: 'hello-ack',
        requestId: message.id,
        payload: { sessionId: peer.sessionId, serverVersion: this.options.serverVersion }
      })
      this.startKeepalive(peer)
      return
    }

    if (!peer.authenticated) return // всё, кроме hello, до аутентификации молча игнорируется

    if (message.kind === 'pong') {
      if (peer.pongTimeout) clearTimeout(peer.pongTimeout)
      peer.pongTimeout = null
      return
    }

    if ((message.kind === 'response' || message.kind === 'error') && message.requestId) {
      const pending = this.pending.get(message.requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(message.requestId)
        pending.resolve(message)
        return
      }
    }

    this.options.onMessage?.(message, (reply) => this.replyTo(peer, reply))
  }

  private startKeepalive(peer: Peer): void {
    peer.pingTimer = setInterval(() => {
      const pingId = nanoid()
      this.replyTo(peer, { protocolVersion: PROTOCOL_VERSION, id: pingId, kind: 'ping', payload: {} })
      peer.pongTimeout = setTimeout(() => peer.socket.terminate(), PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  private replyTo(peer: Peer, message: BridgeMessage): void {
    if (peer.socket.readyState !== 1 /* OPEN */) return
    peer.socket.send(encodeBridgeMessage(message))
  }

  private teardownPeer(peer: Peer): void {
    if (peer.pingTimer) clearInterval(peer.pingTimer)
    if (peer.pongTimeout) clearTimeout(peer.pongTimeout)
    this.peers.delete(peer)
    this.options.onConnectionCountChange?.(this.peers.size)
  }
}

function isAddrInUse(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'EADDRINUSE'
}
