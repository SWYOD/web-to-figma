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

interface TextRun {
  text: string
  typography: TypographyInfo
  color: Color
}

/** @deprecated Оставлено только для чтения документов старого desktop —
 *  новое component recognition (см. "Статус реализации") никогда не
 *  вкладывает эту команду в DesignNode, рендерер это поле игнорирует. */
interface ComponentRef {
  groupId: string
  role: 'main' | 'instance'
  overrides?: { text?: Record<string, string>; assets?: Record<string, string> }
}

interface DesignNode {
  id: string
  type: NodeType
  name: string
  size: Size
  layout?: LayoutInfo
  typography?: TypographyInfo
  text?: string
  /** Фактическое поведение строки в браузере, а не только authored
   *  white-space. `nowrap` ставится и когда захваченный текст реально занял
   *  одну строку — глифовые метрики Figma и браузера расходятся достаточно,
   *  чтобы короткий текст вроде "45" перенёсся на вторую строку в Figma при
   *  фиксированной ширине; на стороне рендерера превращается в настоящий
   *  `textAutoResize:'WIDTH_AND_HEIGHT'`, см. "Статус реализации". */
  textWrap?: 'wrap' | 'nowrap'
  /** Смешанный текст — присутствует ВМЕСТО `text`, когда узел содержит
   *  "голый" текст вперемешку с инлайновыми тегами форматирования
   *  (`<b>`/`<a>`/`<i>`/...). Взаимоисключающе с `text`. */
  textRuns?: TextRun[]
  fills?: Paint[]
  strokes?: StrokeInfo
  effects?: Effect[]
  cornerRadius?: number | CornerRadius
  opacity?: number
  rotationDeg?: number
  /** Из CSS overflow/overflow-x/overflow-y — true, если хоть одна ось не 'visible'
   *  (браузерный дефолт). undefined трактуется как false, не как дефолт Figma API. */
  clipsContent?: boolean
  asset?: AssetReference
  /** Оригинальный DOM-контекст — не рендерится, только для диагностики/повторного импорта. */
  source?: { tag: string; id?: string; classes?: string[]; cssSelector?: string }
  /** @deprecated См. ComponentRef выше. */
  componentRef?: ComponentRef
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
  На практике (см. "Статус реализации" ниже) компонентный workflow пошёл
  другим путём, чем предполагал `componentRef` — `type` расширения
  `'component'`/`'instance'` так и не понадобилось.
- Design tokens (переменные) — п.28 ТЗ, отдельная модель поверх `DesignDocument`
  (агрегация по всем узлам), не часть самого AST одного элемента.
- `::before`/`::after` — материализуются как обычные дочерние `DesignNode`
  конвертером (Phase, где обрабатываются pseudo-elements), в самой модели
  никакого специального типа для них нет — они неотличимы от обычных узлов.

## Статус реализации

`packages/design-ast` (Phase 1) содержит типы + Zod-схемы для рантайм-валидации
на границе bridge (сообщение `ImportNodeMessage` содержит `DesignDocument`,
который должен быть провалидирован до применения в Figma — untrusted-граница
процесса).

`packages/conversion-engine` строит `DesignNode`-дерево из DOM/CSS-снапшота
(`convertElement`) — типизированные Paint/StrokeInfo/TypographyInfo/
CornerRadius/Effect[] из сырых computed-style значений (Phase 5), Auto Layout
inference для `display:flex` (Phase 7), рекурсия по `children` + absolute
positioning + материализация `::before`/`::after` (Phase 8), `type:'image'`/
`'vector'` через asset-engine (Phase 9) — всё done.

**`type:'text'` — реальные текстовые узлы с содержимым, реализовано.**
`apps/desktop/src/main/domSnapshot.ts` при обходе CDP-дерева помечает
"чистый текстовый лист" (все прямые дети — DOM-текстовые узлы, ни одного
вложенного элемента) полем `text` на `DomSnapshotNode`; `convertElement`
превращает такой узел в `type:'text'` вместо `'frame'`, `node.fills` для
такого узла — это CSS `color` (цвет глифов), а не `background-color` (у
Figma TextNode нет фона — непрозрачный `background-color` на текстовом
листе даёт diagnostic `text-background-dropped`, а не тихо теряется).
Смешанный контент (текст вперемешку с инлайновыми тегами форматирования,
напр. `<p>Some <b>x</b> text</p>`) материализуется как ОДИН текстовый узел
со стилизованными диапазонами — `DesignNode.textRuns` (взаимоисключающе с
`text`), см. `TextRunSchema`. Разворачивание успешно, только если ВСЕ
вложенные элементы — "чисто инлайновые" теги форматирования (`B/STRONG/I/
EM/U/S/STRIKE/SPAN/A/SMALL/MARK/SUB/SUP/CODE/ABBR/CITE/Q/TIME/LABEL`, `BR`);
если среди них попался НЕ инлайновый тег (картинка, блочный элемент —
Figma TextNode не умеет встроенные картинки внутри текста) — откат на старое
поведение: вложенные элементы конвертируются как обычно каждый сам по себе,
а "голый" текст вокруг них теряется с diagnostic
`mixed-inline-text-not-captured`, не молча.
На стороне Figma Plugin — `renderers/textNode.ts`: создаёт `figma.createText()`
с подобранным начертанием под CSS font-weight (эвристика по общепринятым
именам стилей — "Bold"/"SemiBold"/...), с фолбэком на Inter Regular, если
`loadFontAsync` бросает (шрифт/начертание не установлены в Figma) — весь
рендер-пайплайн (`designNode.ts`) поэтому асинхронный.

**"Стили проекта" (`useMatchedTextStyles`/`useMatchedColorStyles`, раздельно) —
необязательный второй проход поверх raw-рендера.** `renderers/styleMatching.ts`
подбирает ближайший локальный text style (по fontSize И весу начертания —
вес доминирует подбор, fontSize только tie-breaker среди кандидатов одного
начертания) / цвет — Paint Style ИЛИ Figma Variable (`colorMatchSource`,
переключатель у пользователя) по RGBA-расстоянию — и привязывает узел к нему
(`setTextStyleIdAsync`/`fillStyleId`/`strokeStyleId`/`setBoundVariableForPaint`)
вместо raw-значения — независимо для шрифтов и для цветов, только когда
соответствующий флаг `ImportNodeMessage.payload` включён (desktop-настройка),
и только если подходящий кандидат реально нашёлся, иначе raw-значение
остаётся как есть. См. `docs/architecture.md`,
`docs/bridge-protocol.md`.

**Auto Layout `fill`-sizing (`widthSizing`/`heightSizing`) — реализовано.**
`convertElement`'s `resolveSizing()` вычисляет `'fill'` из `flex-grow > 0`
(главная ось родителя) и `align-items:stretch`/CSS-дефолт (поперечная ось,
если `align-self` ребёнка не переопределяет) — см. `conversion-rules.md`.
`'hug'` сознательно не реализован (нужен authored CSS, не только
computed-style). На стороне Figma Plugin `layoutSizingHorizontal`/`Vertical`
выставляются только для не-absolute детей реального Auto Layout родителя.

CSS Grid — только направление в conversion-rules.md, не код.

**`componentRef` — `@deprecated`.** Изначально (между тегом v0.1.8 и релизом
v0.1.9) `convertElement.ts` умел вкладывать `componentRef` прямо в
`DesignNode` — обычный импорт автоматически распознавал структурно
идентичные соседние узлы и размечал их `role:'main'`/`'instance'` +
`overrides`, рендерер превращал это в реальный Figma Component/Instance по
ходу обычного дерева. Этот путь заменён на opt-in "Компоненты"-вкладку (см.
`docs/architecture.md`, секцию "Компоненты: автоматическая группировка убрана")
— отдельный read-only инвентарь кандидатов, создание в Figma только по явному
клику на карточке, никогда не через обычный Import as Frame. `componentRef`
оставлено в схеме и типах **только для чтения уже существующих документов**,
созданных до этого перехода — новый код (`convertElement.ts`,
`designNode.ts`) это поле не производит и не читает. Не путать со
структурно похожим, но отдельным `RecognizedComponentCandidate`
(`packages/conversion-engine/src/componentGroups.ts`) — тот вообще не входит
в `DesignNode`/`DesignDocument`, это отдельный тип только для панели.
