/**
 * Третий, независимый канал в Bridge Tools — прямая связь с Design Toolkit
 * (`F:\6_ClaudeProjects\design-toolkit`, отдельный репозиторий), по запросу
 * пользователя: "создавать инструменты, которые будут взаимодействовать с
 * канвасом напрямую". Та же идея, что и у DesignAgent-канала
 * (`designAgentClient.ts`) — этот плагин говорит на протоколе другого
 * приложения вместо того, чтобы Figma держала два плагина одновременно — но
 * здесь плагин НЕ клиент "к известному порту брокера", а клиент, который
 * САМ ИЩЕТ хост, как основной bridge к desktop-приложению Web To Figma
 * (см. `discoverPairing` в App.tsx) — по прямому запросу пользователя,
 * никакой ручной кнопки "Start" быть не должно.
 *
 * Design Toolkit — СЕРВЕР (обычный Electron main-процесс умеет слушать порт,
 * плагин в песочнице iframe — нет), протокол — минимальный ручной аналог
 * основного bridge-протокола (см. design-toolkit/src/main/canvasBridgeServer.ts):
 * `/pairing` HTTP GET → `{token}`, дальше WS `hello`(token)/`hello-ack`/
 * `hello-reject`, затем сервер шлёт `{type:'command', id, command, params}`
 * на каждый вызов инструмента внутри Design Toolkit — выполняем через main
 * sandbox (`runDesignAgentCommand`, ТОТ ЖЕ диспетчер команд, что и у канала
 * DesignAgent — полный набор, как у DesignAgent, по явному запросу
 * пользователя, не отдельный урезанный протокол) и отвечаем
 * `{type:'result', id, ok, result|error}`.
 */

export type CanvasToolkitState = 'searching' | 'connecting' | 'connected'

export interface CanvasToolkitClientOptions {
  WebSocketImpl?: typeof WebSocket
  onStateChange?: (state: CanvasToolkitState) => void
  /** Выполняет команду через main sandbox (единственное место с доступом к figma.*) — переиспользует runDesignAgentCommand. */
  runCommand: (command: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>
}

const DEFAULT_PORT = 53900
const PORT_FALLBACK_RANGE = 9
const DISCOVERY_TIMEOUT_MS = 1200
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

interface ServerMessage {
  type?: string
  id?: string
  command?: string
  params?: unknown
  reason?: string
}

/** Опрашивает `/pairing` на каждом порту диапазона параллельно — тот же
 *  паттерн, что уже использует основной канал к desktop-приложению Web To
 *  Figma (см. App.tsx `discoverPairing`), только другой, независимый
 *  диапазон портов (Design Toolkit, не web-to-figma desktop). */
async function discoverToolkit(): Promise<{ token: string; port: number } | null> {
  const ports = Array.from({ length: PORT_FALLBACK_RANGE + 1 }, (_, i) => DEFAULT_PORT + i)
  const attempts = ports.map(async (port) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
    try {
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
  const found = results.find((r): r is PromiseFulfilledResult<{ token: string; port: number }> => r.status === 'fulfilled')
  return found?.value ?? null
}

export class CanvasToolkitClient {
  private ws: WebSocket | null = null
  private state: CanvasToolkitState = 'searching'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = true

  constructor(private readonly options: CanvasToolkitClientOptions) {}

  connect(): void {
    this.stopped = false
    void this.findAndOpen()
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.setState('searching')
  }

  getState(): CanvasToolkitState {
    return this.state
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState !== 1 /* OPEN */) return
    this.ws.send(JSON.stringify(payload))
  }

  private async findAndOpen(): Promise<void> {
    this.setState('searching')
    const found = await discoverToolkit()
    if (this.stopped) return
    if (!found) {
      this.scheduleReconnect()
      return
    }
    this.openSocket(found.token, found.port)
  }

  private openSocket(token: string, port: number): void {
    this.setState('connecting')
    const Impl = this.options.WebSocketImpl ?? WebSocket
    const ws = new Impl(`ws://localhost:${port}`)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.send({ type: 'hello', token })
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      let msg: ServerMessage
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      void this.handleMessage(msg)
    })

    ws.addEventListener('close', () => {
      if (this.stopped) return
      this.scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      // 'close' всегда следует за 'error' — переподключение планируется там.
    })
  }

  private async handleMessage(msg: ServerMessage): Promise<void> {
    if (msg.type === 'hello-ack') {
      this.reconnectAttempt = 0
      this.setState('connected')
      return
    }
    if (msg.type === 'hello-reject') {
      // Токен устарел (Design Toolkit перезапустился с новым) — ищем заново с нуля.
      this.ws?.close()
      this.scheduleReconnect()
      return
    }
    if (msg.type === 'command' && typeof msg.id === 'string') {
      const command = String(msg.command ?? '')
      const params = msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {}
      const outcome = await this.options.runCommand(command, params)
      this.send({ type: 'result', id: msg.id, ok: outcome.ok, ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }) })
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.setState('searching')
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => void this.findAndOpen(), delay)
  }

  private setState(state: CanvasToolkitState): void {
    if (this.state === state) return
    this.state = state
    this.options.onStateChange?.(state)
  }
}
