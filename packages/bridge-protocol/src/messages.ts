import { z } from 'zod'
import { DesignDocumentSchema } from '@web-to-figma/design-ast'
import { PROTOCOL_VERSION } from './constants.js'

/**
 * Envelope + BridgeMessage — контракт desktop ⇄ figma-plugin.
 * См. docs/bridge-protocol.md. Каждая ветка объявлена как отдельная
 * Zod-схема и собрана в discriminated union по `kind` — на входе всегда
 * `BridgeMessageSchema.safeParse`, никогда доверительный `JSON.parse`.
 */

const base = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string()
}

export const HelloMessageSchema = z.object({
  ...base,
  kind: z.literal('hello'),
  payload: z.object({
    token: z.string(),
    client: z.literal('figma-plugin'),
    clientVersion: z.string()
  })
})

export const HelloAckMessageSchema = z.object({
  ...base,
  kind: z.literal('hello-ack'),
  requestId: z.string(),
  payload: z.object({
    sessionId: z.string(),
    serverVersion: z.string()
  })
})

export const HelloRejectMessageSchema = z.object({
  ...base,
  kind: z.literal('hello-reject'),
  requestId: z.string(),
  payload: z.object({
    reason: z.enum(['AUTH_FAILED', 'VERSION_UNSUPPORTED'])
  })
})

export const PingMessageSchema = z.object({
  ...base,
  kind: z.literal('ping'),
  payload: z.object({})
})

export const PongMessageSchema = z.object({
  ...base,
  kind: z.literal('pong'),
  requestId: z.string(),
  payload: z.object({})
})

export const GetSelectionMessageSchema = z.object({
  ...base,
  kind: z.literal('get-selection'),
  payload: z.object({})
})

export const ImportNodeMessageSchema = z.object({
  ...base,
  kind: z.literal('import-node'),
  payload: z.object({
    document: DesignDocumentSchema,
    as: z.enum(['frame', 'component']),
    /** "Стили проекта" (см. styleMatching.ts в figma-plugin) — подбирать
     *  ближайший локальный style вместо raw-значения, отдельно для шрифтов
     *  (text style) и для цветов (paint style/fills+strokes) — пользователь
     *  явно попросил раздельные переключатели, не один общий. Optional для
     *  обратной совместимости со старым desktop-клиентом; отсутствие == false. */
    useMatchedTextStyles: z.boolean().optional(),
    useMatchedColorStyles: z.boolean().optional(),
    /** Цвет матчится на Paint Style ('style', легаси) или на Figma Variable
     *  ('variable') — пользователь явно попросил выбор. Optional/дефолт
     *  'style' для обратной совместимости. */
    colorMatchSource: z.enum(['style', 'variable']).optional()
  })
})

export const ImportAssetMessageSchema = z.object({
  ...base,
  kind: z.literal('import-asset'),
  payload: z.object({ assetId: z.string() })
})

export const ImportAssetsMessageSchema = z.object({
  ...base,
  kind: z.literal('import-assets'),
  payload: z.object({ assetIds: z.array(z.string()) })
})

export const ApplyStylesMessageSchema = z.object({
  ...base,
  kind: z.literal('apply-styles'),
  payload: z.object({
    document: DesignDocumentSchema,
    targets: z.object({
      typography: z.boolean(),
      fill: z.boolean(),
      border: z.boolean(),
      radius: z.boolean(),
      effects: z.boolean(),
      layout: z.boolean(),
      dimensions: z.boolean()
    })
  })
})

export const ResponseMessageSchema = z.object({
  ...base,
  kind: z.literal('response'),
  requestId: z.string(),
  payload: z.record(z.string(), z.unknown())
})

export const ErrorMessageSchema = z.object({
  ...base,
  kind: z.literal('error'),
  requestId: z.string().optional(),
  payload: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
})

export const BridgeMessageSchema = z.discriminatedUnion('kind', [
  HelloMessageSchema,
  HelloAckMessageSchema,
  HelloRejectMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
  GetSelectionMessageSchema,
  ImportNodeMessageSchema,
  ImportAssetMessageSchema,
  ImportAssetsMessageSchema,
  ApplyStylesMessageSchema,
  ResponseMessageSchema,
  ErrorMessageSchema
])

export type HelloMessage = z.infer<typeof HelloMessageSchema>
export type HelloAckMessage = z.infer<typeof HelloAckMessageSchema>
export type HelloRejectMessage = z.infer<typeof HelloRejectMessageSchema>
export type PingMessage = z.infer<typeof PingMessageSchema>
export type PongMessage = z.infer<typeof PongMessageSchema>
export type GetSelectionMessage = z.infer<typeof GetSelectionMessageSchema>
export type ImportNodeMessage = z.infer<typeof ImportNodeMessageSchema>
export type ImportAssetMessage = z.infer<typeof ImportAssetMessageSchema>
export type ImportAssetsMessage = z.infer<typeof ImportAssetsMessageSchema>
export type ApplyStylesMessage = z.infer<typeof ApplyStylesMessageSchema>
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>
export type BridgeMessageKind = BridgeMessage['kind']
