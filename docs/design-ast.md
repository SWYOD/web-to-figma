# Design AST

Платформонезависимая промежуточная модель между `conversion-engine` (источник)
и Figma-рендерером в `apps/figma-plugin` (потребитель). Живёт в
`packages/design-ast`. Никаких Figma-типов (`SceneNode`, `Paint` из Figma API)
и никаких DOM-типов внутри — только сериализуемые данные.

## Принципы

1. **Versioned.** `DesignDocument.version` — если модель меняется несовместимо,
   версия растёт, и bridge-protocol/рендерер обязаны знать, какие версии умеют
   читать.
2. **Assets — по ссылке, не инлайн в дереве.** Узел хранит `AssetReference`
   (id), сами байты/метаданные — в `AssetManifest` документа. Одна и та же
   иконка, использованная 20 раз, — одна запись в манифесте.
3. **Семантика важнее пиксель-перфекта.** Модель обязана уметь выразить
   Auto-Layout-подобный layout (`layout.mode`), а не только абсолютные
   координаты — см. `conversion-rules.md`.
4. **`DesignNode` — редактируемое дерево, а не снимок экрана.** Поля соответствуют
   тому, что реально можно выставить в Figma (Auto Layout, sizing, fills,
   effects), не "визуальным пикселям".

## Модель

```ts
type NodeType = 'frame' | 'text' | 'image' | 'vector' | 'group'

interface Size {
  width: number
  height: number
}

interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

type SizingMode = 'fixed' | 'hug' | 'fill'

interface LayoutInfo {
  mode: 'horizontal' | 'vertical' | 'grid' | 'none'
  gap?: number
  rowGap?: number
  columnGap?: number
  padding?: Padding
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  widthSizing?: SizingMode
  heightSizing?: SizingMode
  positioning?: 'auto' | 'absolute'
  /** Заполняется только когда positioning === 'absolute'; координаты относительно родителя. */
  absolute?: { x: number; y: number }
  grid?: {
    columns: number
    rows?: number
    columnGap?: number
    rowGap?: number
  }
}

interface TypographyInfo {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight?: number | 'normal'
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textCase?: 'none' | 'upper' | 'lower' | 'title'
  textDecoration?: 'none' | 'underline' | 'strikethrough'
}

type Color = { r: number; g: number; b: number; a: number } // 0..1

type Paint =
  | { type: 'solid'; color: Color }
  | { type: 'linear-gradient'; angleDeg: number; stops: { offset: number; color: Color }[] }
  | { type: 'radial-gradient'; stops: { offset: number; color: Color }[] }
  | { type: 'image'; assetId: string; fit: 'fill' | 'fit' | 'crop' | 'tile' }

interface StrokeInfo {
  paints: Paint[]
  weight: number
}

type Effect =
  | { type: 'drop-shadow'; color: Color; offsetX: number; offsetY: number; blur: number; spread?: number }
  | { type: 'inner-shadow'; color: Color; offsetX: number; offsetY: number; blur: number; spread?: number }
  | { type: 'layer-blur'; radius: number }
  | { type: 'background-blur'; radius: number }

interface CornerRadius {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

interface AssetReference {
  assetId: string
}

interface DesignNode {
  id: string
  type: NodeType
  name: string
  size: Size
  layout?: LayoutInfo
  typography?: TypographyInfo
  text?: string
  fills?: Paint[]
  strokes?: StrokeInfo
  effects?: Effect[]
  cornerRadius?: number | CornerRadius
  opacity?: number
  rotationDeg?: number
  asset?: AssetReference
  /** Оригинальный DOM-контекст — не рендерится, только для диагностики/повторного импорта. */
  source?: { tag: string; id?: string; classes?: string[]; cssSelector?: string }
  children?: DesignNode[]
}

interface ConversionWarning {
  nodeId: string
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

interface DesignDocument {
  version: 1
  root: DesignNode
  assets: Record<string, DesignAsset> // AssetManifest, см. asset-model.md
  diagnostics: ConversionWarning[]
  metadata: {
    sourceUrl: string
    capturedAt: string // ISO
    viewport: Size
    userAgent?: string
  }
}
```

## Что намеренно НЕ входит в v1

- Component/variant properties (Figma Component Properties API) — заложено в
  `DesignNode.type` (можно добавить `'component'`/`'instance'` позже без
  breaking change остальной модели), но сама механика properties/variants —
  Phase "Повторяющиеся структуры" (п.27 ТЗ), не Phase 1-8.
  ⇒ **`type` — открытый union, версия модели не меняется при его расширении**,
  но потребители (рендерер) обязаны иметь `default`-ветку на неизвестный тип.
- Design tokens (переменные) — п.28 ТЗ, отдельная модель поверх `DesignDocument`
  (агрегация по всем узлам), не часть самого AST одного элемента.
- `::before`/`::after` — материализуются как обычные дочерние `DesignNode`
  конвертером (Phase, где обрабатываются pseudo-elements), в самой модели
  никакого специального типа для них нет — они неотличимы от обычных узлов.

## Реализация в Phase 1

В `packages/design-ast` сейчас лежат только типы + Zod-схемы для рантайм-валидации
на границе bridge (сообщение `ImportNodeMessage` содержит `DesignDocument`,
который должен быть провалидирован до применения в Figma — untrusted-граница
процесса). Никакой логики построения AST ещё нет — это Phase 5.
