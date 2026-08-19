import { WebSocketServer, type WebSocket as WSSocket } from 'ws'
import { nanoid } from 'nanoid'
import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, PORT_FALLBACK_RANGE, PROTOCOL_VERSION } from './constants.js'
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

export class BridgeServer {
  private wss: WebSocketServer | null = null
  private readonly peers = new Set<Peer>()

  constructor(private readonly options: BridgeServerOptions) {}

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
