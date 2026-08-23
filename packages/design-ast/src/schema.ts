import { z } from 'zod'

/**
 * Zod-схемы — источник истины для Design AST (см. docs/design-ast.md).
 * Типы (design-ast.md) выводятся из схем через z.infer, чтобы модель и
 * runtime-валидация на границе bridge не могли разойтись.
 */

export const SizeSchema = z.object({
  width: z.number(),
  height: z.number()
})

export const PaddingSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number()
})

export const SizingModeSchema = z.enum(['fixed', 'hug', 'fill'])

export const LayoutInfoSchema = z.object({
  mode: z.enum(['horizontal', 'vertical', 'grid', 'none']),
  /** CSS flex-wrap. Figma Auto Layout умеет WRAP для горизонтального и
   * вертикального потока; без этого дети выходят за фиксированную ширину. */
  wrap: z.boolean().optional(),
  gap: z.number().optional(),
  rowGap: z.number().optional(),
  columnGap: z.number().optional(),
  padding: PaddingSchema.optional(),
  align: z.enum(['start', 'center', 'end', 'baseline', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'space-between', 'space-around']).optional(),
  widthSizing: SizingModeSchema.optional(),
  heightSizing: SizingModeSchema.optional(),
  positioning: z.enum(['auto', 'absolute']).optional(),
  absolute: z.object({ x: z.number(), y: z.number() }).optional(),
  grid: z
    .object({
      columns: z.number(),
      rows: z.number().optional(),
      columnGap: z.number().optional(),
      rowGap: z.number().optional()
    })
    .optional()
})

export const TypographyInfoSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  lineHeight: z.union([z.number(), z.literal('normal')]).optional(),
  letterSpacing: z.number().optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  textCase: z.enum(['none', 'upper', 'lower', 'title']).optional(),
  textDecoration: z.enum(['none', 'underline', 'strikethrough']).optional()
})

export const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1)
})

/** Один стилизованный диапазон внутри смешанного текста (п.3 запроса
 *  пользователя — "смешанный текст"), напр. один прогон "жирный курсив" в
 *  "текст <b><i>жирный курсив</i></b> ещё текст". `typography`/`color` —
 *  собственные вычисленные значения ЭТОГО прогона (уже с учётом каскада
 *  CSS — резолвятся из computed style конкретного инлайн-элемента, см.
 *  conversion-engine/convertElement.ts). См. `DesignNode.textRuns`. */
export const TextRunSchema = z.object({
  text: z.string(),
  typography: TypographyInfoSchema,
  color: ColorSchema
})

export const PaintSchema: z.ZodType<
  | { type: 'solid'; color: z.infer<typeof ColorSchema> }
  | { type: 'linear-gradient'; angleDeg: number; stops: { offset: number; color: z.infer<typeof ColorSchema> }[] }
  | { type: 'radial-gradient'; stops: { offset: number; color: z.infer<typeof ColorSchema> }[] }
  | { type: 'image'; assetId: string; fit: 'fill' | 'fit' | 'crop' | 'tile' }
> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: ColorSchema }),
  z.object({
    type: z.literal('linear-gradient'),
    angleDeg: z.number(),
    stops: z.array(z.object({ offset: z.number(), color: ColorSchema }))
  }),
  z.object({
    type: z.literal('radial-gradient'),
    stops: z.array(z.object({ offset: z.number(), color: ColorSchema }))
  }),
  z.object({
    type: z.literal('image'),
    assetId: z.string(),
    fit: z.enum(['fill', 'fit', 'crop', 'tile'])
  })
])

export const StrokeInfoSchema = z.object({
  paints: z.array(PaintSchema),
  weight: z.number()
})

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('drop-shadow'),
    color: ColorSchema,
    offsetX: z.number(),
    offsetY: z.number(),
    blur: z.number(),
    spread: z.number().optional()
  }),
  z.object({
    type: z.literal('inner-shadow'),
    color: ColorSchema,
    offsetX: z.number(),
    offsetY: z.number(),
    blur: z.number(),
    spread: z.number().optional()
  }),
  z.object({ type: z.literal('layer-blur'), radius: z.number() }),
  z.object({ type: z.literal('background-blur'), radius: z.number() })
])

export const CornerRadiusSchema = z.object({
  topLeft: z.number(),
  topRight: z.number(),
  bottomRight: z.number(),
  bottomLeft: z.number()
})

export const AssetReferenceSchema = z.object({
  assetId: z.string()
})

/** @deprecated Оставлено только для чтения документов старого desktop.
 * Новое распознавание возвращает отдельный inventory и никогда не вкладывает
 * команду создания Component/Instance в DesignNode. Рендерер это поле игнорирует. */
export const ComponentRefSchema = z.object({
  groupId: z.string(),
  role: z.enum(['main', 'instance']),
  overrides: z
    .object({
      text: z.record(z.string(), z.string()).optional(),
      assets: z.record(z.string(), z.string()).optional()
    })
    .optional()
})

export const NodeTypeSchema = z.enum(['frame', 'text', 'image', 'vector', 'group'])

export interface DesignNode {
  id: string
  type: z.infer<typeof NodeTypeSchema>
  name: string
  size: z.infer<typeof SizeSchema>
  layout?: z.infer<typeof LayoutInfoSchema>
  typography?: z.infer<typeof TypographyInfoSchema>
  text?: string
  /** Фактическое поведение строки в браузере. nowrap применяется не только
   * для CSS white-space:nowrap, но и когда захваченный текст реально занял
   * одну строку — защищает от отличий метрик шрифта Figma, превращающих
   * горизонтальный текст вроде "45" в столбик. */
  textWrap?: 'wrap' | 'nowrap'
  /** Смешанный текст (п.3 запроса пользователя) — присутствует ВМЕСТО `text`,
   *  когда узел содержит "голый" текст вперемешку с инлайновыми тегами
   *  форматирования (`<b>`/`<a>`/`<i>`/...), которые раньше конвертировались
   *  отдельными узлами с потерей окружающего текста (diagnostic
   *  `mixed-inline-text-not-captured`). Взаимоисключающе с `text` — оба поля
   *  разом не выставляются. */
  textRuns?: z.infer<typeof TextRunSchema>[]
  fills?: z.infer<typeof PaintSchema>[]
  strokes?: z.infer<typeof StrokeInfoSchema>
  effects?: z.infer<typeof EffectSchema>[]
  cornerRadius?: number | z.infer<typeof CornerRadiusSchema>
  opacity?: number
  rotationDeg?: number
  /** Из CSS `overflow`/`overflow-x`/`overflow-y` — true, если хоть одна ось не
   *  'visible' (браузерный дефолт). Без этого дети, выходящие за пределы
   *  родителя (напр. декоративные ::before/::after со смещением через
   *  transform), либо утекают за край видимого фрейма там, где сайт их
   *  обрезает, либо наоборот обрезаются там, где сайт даёт им "вытечь" —
   *  оба расхождения заметны на глаз. Undefined трактуется как false
   *  (CSS-дефолт), а не наследует поведение Figma API по умолчанию. */
  clipsContent?: boolean
  asset?: z.infer<typeof AssetReferenceSchema>
  source?: { tag: string; id?: string; classes?: string[]; cssSelector?: string }
  /** @deprecated См. ComponentRefSchema. */
  componentRef?: z.infer<typeof ComponentRefSchema>
  children?: DesignNode[]
}

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: NodeTypeSchema,
    name: z.string(),
    size: SizeSchema,
    layout: LayoutInfoSchema.optional(),
    typography: TypographyInfoSchema.optional(),
    text: z.string().optional(),
    textWrap: z.enum(['wrap', 'nowrap']).optional(),
    textRuns: z.array(TextRunSchema).optional(),
    fills: z.array(PaintSchema).optional(),
    strokes: StrokeInfoSchema.optional(),
    effects: z.array(EffectSchema).optional(),
    cornerRadius: z.union([z.number(), CornerRadiusSchema]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotationDeg: z.number().optional(),
    clipsContent: z.boolean().optional(),
    asset: AssetReferenceSchema.optional(),
    source: z
      .object({
        tag: z.string(),
        id: z.string().optional(),
        classes: z.array(z.string()).optional(),
        cssSelector: z.string().optional()
      })
      .optional(),
    componentRef: ComponentRefSchema.optional(),
    children: z.array(DesignNodeSchema).optional()
  })
)

export const ConversionWarningSchema = z.object({
  nodeId: z.string(),
  code: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string()
})

export const AssetKindSchema = z.enum(['raster', 'svg', 'background', 'icon'])

export const AssetTransportSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inline'), data: z.string() }),
  z.object({ mode: z.literal('ref'), token: z.string() })
])

export const DesignAssetSchema = z.object({
  id: z.string(),
  kind: AssetKindSchema,
  sourceUrl: z.string().optional(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  hash: z.string(),
  transport: AssetTransportSchema
})

export const DesignDocumentSchema = z.object({
  version: z.literal(1),
  root: DesignNodeSchema,
  assets: z.record(z.string(), DesignAssetSchema),
  diagnostics: z.array(ConversionWarningSchema),
  metadata: z.object({
    sourceUrl: z.string(),
    capturedAt: z.string(),
    viewport: SizeSchema,
    userAgent: z.string().optional()
  })
})

export type Size = z.infer<typeof SizeSchema>
export type Padding = z.infer<typeof PaddingSchema>
export type SizingMode = z.infer<typeof SizingModeSchema>
export type LayoutInfo = z.infer<typeof LayoutInfoSchema>
export type TypographyInfo = z.infer<typeof TypographyInfoSchema>
export type Color = z.infer<typeof ColorSchema>
export type TextRun = z.infer<typeof TextRunSchema>
export type Paint = z.infer<typeof PaintSchema>
export type StrokeInfo = z.infer<typeof StrokeInfoSchema>
export type Effect = z.infer<typeof EffectSchema>
export type CornerRadius = z.infer<typeof CornerRadiusSchema>
export type AssetReference = z.infer<typeof AssetReferenceSchema>
export type ComponentRef = z.infer<typeof ComponentRefSchema>
export type NodeType = z.infer<typeof NodeTypeSchema>
export type ConversionWarning = z.infer<typeof ConversionWarningSchema>
export type AssetKind = z.infer<typeof AssetKindSchema>
export type AssetTransport = z.infer<typeof AssetTransportSchema>
export type DesignAsset = z.infer<typeof DesignAssetSchema>
export type AssetManifest = Record<string, DesignAsset>
export type DesignDocument = z.infer<typeof DesignDocumentSchema>
