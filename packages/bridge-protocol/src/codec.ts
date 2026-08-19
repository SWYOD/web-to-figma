import { nanoid } from 'nanoid'
import { PROTOCOL_VERSION } from './constants.js'
import { BridgeMessageSchema, type BridgeMessage } from './messages.js'

export type ParsedMessage =
  | { ok: true; message: BridgeMessage }
  | { ok: false; error: string; rawId?: string }

/** Единственная точка входа для недоверенных байт с сокета — см. docs/bridge-protocol.md §Валидация. */
export function parseBridgeMessage(raw: string): ParsedMessage {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  const result = BridgeMessageSchema.safeParse(json)
  if (!result.success) {
    const rawId =
      typeof json === 'object' && json !== null && 'id' in json && typeof (json as { id: unknown }).id === 'string'
        ? (json as { id: string }).id
        : undefined
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), rawId }
  }
  return { ok: true, message: result.data }
}

export function encodeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message)
}

/** Строит сообщение-запрос (новый `id`, без `requestId`). */
export function createMessage<T extends BridgeMessage>(kind: T['kind'], payload: T['payload']): T {
  return { protocolVersion: PROTOCOL_VERSION, id: nanoid(), kind, payload } as T
}

/** Строит сообщение-ответ на конкретный запрос (`requestId` обязателен). */
export function createResponse<T extends BridgeMessage & { requestId?: string }>(
  kind: T['kind'],
  requestId: string,
  payload: T['payload']
): T {
  return { protocolVersion: PROTOCOL_VERSION, id: nanoid(), kind, requestId, payload } as T
}
