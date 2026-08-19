export const PROTOCOL_VERSION = 1 as const

export const DEFAULT_PORT = 52847
/** Если дефолтный порт занят, сервер пробует следующие по порядку (см. docs/bridge-protocol.md). */
export const PORT_FALLBACK_RANGE = 9

export const PING_INTERVAL_MS = 15_000
export const PONG_TIMEOUT_MS = 5_000

/** Экспоненциальный backoff клиента при переподключении, потолок — последнее значение. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]

export const REQUEST_TIMEOUT_MS = 10_000

export const CLIENT_NAME = 'figma-plugin' as const
