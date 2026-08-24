# DOM/CSS → Figma Layout: правила конверсии

**Статус: частично реализовано.** Описывает согласованные правила для
`conversion-engine` (Phase 5-8) — решения фиксируются здесь до кода, не
изобретаются по ходу дела. Phase 5 (done) реализует раздел про типизацию
Fill/Stroke/Typography/CornerRadius/Effects из computed-style одного узла;
Phase 7 (done) реализует "Flexbox → Auto Layout" (mode/gap/align/justify);
Phase 8 (done) реализует "Absolute positioning" (с fallback для block-flow
без Auto Layout) и "Псевдоэлементы" ниже — дерево строится рекурсивно,
`::before`/`::after` материализуются как обычные дети. Раздел "CSS Grid" —
всё ещё только направление, не код (это Phase 8 не покрыл — самостоятельный
кусок работы, следующий шаг после text-узлов).

## Главный принцип

Результат должен быть **редактируемым дизайнером**, а не точной пиксельной
копией. При конфликте между "похоже пиксель-в-пиксель" и "нормальная Auto
Layout структура" — побеждает вторая. Источник примеров — п.30 исходного ТЗ
("Хорошо" / "Плохо").

## Flexbox → Auto Layout

| CSS | Figma |
|---|---|
| `display:flex; flex-direction:row` | `layoutMode:'HORIZONTAL'` |
| `display:flex; flex-direction:column` | `layoutMode:'VERTICAL'` |
| `gap` | `itemSpacing` (главная ось — `column-gap` для row/horizontal, `row-gap` для column/vertical) |
| `row-gap`/`column-gap` (реализовано, не приближение) | Оба сохраняются в AST раздельно (`LayoutInfo.rowGap`/`columnGap`), не схлопываются в одно значение. Главная ось идёт в `itemSpacing`; когда `flex-wrap` активен (см. `wrap` ниже), "второй" gap (тот, что НЕ пошёл в `itemSpacing`) идёт в `frame.counterAxisSpacing` — зазор между строками/колонками при переносе. Без wrap второй gap сейчас никуда не применяется (в Figma Auto Layout без wrap нет отдельного понятия "gap поперечной оси") |
| `padding` | `padding{Top,Right,Bottom,Left}` |
| `justify-content: flex-start/center/flex-end` | `primaryAxisAlignItems` прямое соответствие |
| `justify-content: space-between` | Нет прямого аналога в Auto Layout → fallback: `primaryAxisAlignItems:'SPACE_BETWEEN'` (Figma это поддерживает начиная с относительно новых версий API) — если недоступно в целевой версии API, fallback на `'MIN'` + warning |
| `justify-content: space-around/evenly` | Нет аналога вообще → `'MIN'` + explicit warning `code: 'justify-content-approximated'` |
| `align-items` | `counterAxisAlignItems` прямое соответствие (`stretch→STRETCH`, `center→CENTER`, ...) |
| `flex-grow > 0` на ребёнке | `layoutGrow: 1` |
| `flex-wrap: wrap` (реализовано) | `LayoutInfo.wrap:true` → `frame.layoutWrap = 'WRAP'` на стороне плагина, `frame.counterAxisSpacing` = второй gap (см. `row-gap`/`column-gap` выше) |
| Явные `width`/`height` (px), нет сигналов fill | `widthSizing:'fixed'`/`heightSizing:'fixed'` |
| `flex-grow > 0` на flex-ребёнке | `fill` по главной оси родителя (`widthSizing` для row, `heightSizing` для column) — реализовано, `resolveSizing()` в `convertElement.ts` |
| `align-items:stretch` родителя (в т.ч. дефолт `normal`/не задано) без переопределяющего `align-self` на ребёнке | `fill` по поперечной оси (`heightSizing` для row, `widthSizing` для column) — реализовано, тот же `resolveSizing()`; `align-self` на самом ребёнке (`stretch`/иное) имеет приоритет над `align-items` родителя |
| `width: auto` / контент определяет размер (`hug`) | **Не реализовано.** Нужен доступ к authored CSS (`CSS.getMatchedStylesForNode`), а не только computed-style — иначе неотличимо от "width явно указан и просто совпал с содержимым". См. `docs/architecture.md` |

`layoutSizingHorizontal`/`layoutSizingVertical` на стороне Figma Plugin
(`apps/figma-plugin/src/main/renderers/designNode.ts`, `applyChildSizing()`)
выставляются **только** для детей родителя с реальным Auto Layout
(`frame.layoutMode !== 'NONE'`) и только для НЕ-absolute детей — `'FILL'`
вне auto-layout родителя или на absolute-позиционированном ребёнке кидает
runtime-исключение в Figma API (см. JSDoc `LayoutMixin.layoutSizingHorizontal`
в `@figma/plugin-typings`).

## CSS Grid

Grid переносится в Figma Grid **только если** структура укладывается в его
модель без потерь (равные колонки/строки, простой `gap`, без именованных
областей и сложных `grid-template-areas`). Проверяется до конвертации —
если структура "неровная" (разное число колонок в разных местах, `span`,
`auto-fit`/`auto-fill` с нетривиальным `minmax`), используется fallback:
рендер как `layoutMode:'GRID'`-эмуляция через вложенные Auto Layout
horizontal-в-vertical (ряды из ячеек), с warning `code:
'grid-approximated-as-nested-autolayout'`.

Для single-track grid, который приближается к Auto Layout, источник
align/justify — `align-items`/`justify-items` (per-item выравнивание внутри
собственной grid-area), **не** `align-content`/`justify-content` (те двигают
всю сетку треков целиком и на одном треке обычно остаются `normal` —
двигать было бы просто нечего, из-за чего элемент прижимался к краю вместо
ожидаемого центра).

## Absolute positioning

Правило: `position:absolute` ребёнок **не превращает родителя в
`layoutMode:'NONE'`**. Родитель остаётся Auto Layout, если его собственный
`display` это оправдывает; абсолютный ребёнок получает
`layoutPositioning:'ABSOLUTE'` в Figma (это ровно то, что предлагает Figma API
для детей Auto Layout фрейма) с координатами, посчитанными относительно
padding-box родителя. Это прямо покрывает fixture 3 (badge внутри Auto Layout
карточки) — типичный кейс, который нельзя терять.

## block / inline / inline-block

- `display:block` без flex/grid у родителя → вертикальный Auto Layout
  (`layoutMode:'VERTICAL'`, `itemSpacing:0` если margin между соседями не
  задан явно, иначе `itemSpacing` = наблюдаемый межэлементный gap, если он
  консистентен между всеми парами соседей; если непостоянный — abs.
  positioning + warning).
- `display:inline`/`inline-block` соседние элементы, идущие в потоке —
  горизонтальный Auto Layout с `layoutWrap:'WRAP'`, если ширина контейнера
  меньше суммарной ширины детей (типичный inline-контент — теги, чипы).

## overflow / percentages / calc() / transforms

- `overflow:hidden` на фрейме → `clipsContent:true`.
- `overflow:auto/scroll` → тоже `clipsContent:true` + warning (Figma не имеет
  скролла как поведения, только визуальный клип).
- Проценты (`width:50%` и т.п.) — резолвятся в px относительно **фактического
  computed** размера родителя на момент снятия снапшота (через CDP `boxModel`),
  не пересчитываются символически.
- `calc()` — резолвится браузером до снятия снапшота (мы читаем **computed**
  значения через CDP, не исходный CSS текст), поэтому `calc()` как таковой
  никогда не долетает до conversion-engine — на входе всегда уже число.
- Transforms: `translate`/`rotate`/`scale` по отдельности → соответствующие
  Figma-поля (`x/y` смещение, `rotation`, `relativeTransform` для scale).
  Составной `matrix()`/`matrix3d()`/`perspective` → **не раскладывается**,
  warning `code:'transform-simplified'` + узел рендерится без transform (это
  явное требование ТЗ: "один сложный transform не должен ломать импорт всего
  subtree").

## Псевдоэлементы

`::before`/`::after` с `content` (текстовым или пустым, но с視 visual box —
`background`/`border`) материализуются как обычные дочерние `DesignNode`,
вставленные первым/последним ребёнком соответственно. Узел без визуального
эффекта (`content:''` без background/border/size) — не материализуется
(не создаёт мусорный пустой фрейм).

## Текстовые узлы (`type:'text'`)

Элемент становится текстовым листом (`type:'text'`, реальный `figma.createText()`
вместо пустого `'frame'`), только если ВСЕ его прямые DOM-дети — текстовые узлы
(`nodeType:3`), ни одного вложенного элемента. Текст нормализуется как в CSS
`white-space:normal` (схлопывание пробельных последовательностей + trim) —
упрощение, не точный per-node расчёт computed `white-space` (страницы с
`white-space:pre` дадут "сплющенный" текст, известное ограничение).

**Исключение — visual text container.** Figma `TextNode` не умеет фон/рамку/
border-radius/padding. Если у текстового узла (иначе прошедшего условие выше)
задан `display:flex/grid`(-inline) ИЛИ непрозрачный фон, ИЛИ `box-shadow`,
ИЛИ ненулевой padding/border/radius (`hasVisualTextBox()` в
`packages/conversion-engine/src/visualTextContainer.ts`) — узел становится
`type:'frame'` с ровно ОДНИМ синтетическим текстовым ребёнком вместо
`type:'text'` напрямую: сам фрейм несёт фон/рамку/скругление/padding как
обычно, ребёнок несёт только typography/цвет (box-decoration на нём обнулена
явно, иначе фон/рамка задвоились бы). Типичный случай — `<a class="tag-pill">`
или круглая иконка-буква: flex-центрирование + padding + border-radius вокруг
одного слова. Если у контейнера `justify-content:center`, это переносится и в
`text-align:center` синтетического ребёнка — иначе кнопки без отдельного
`<span>` внутри теряли бы центрирование текста.

`DesignNode.textWrap?: 'wrap' | 'nowrap'` — однострочный захваченный текст
(высота ≤ ~1.25×line-height, без явных `\n`/`white-space:pre`/`nowrap`)
принудительно помечается `nowrap`, даже если исходный CSS этого не требует:
браузерные и Figma-глифовые метрики расходятся достаточно, чтобы короткий
текст, помещавшийся в захваченную ширину в браузере, перенёсся на вторую
строку при фиксированной ширине в Figma. На стороне рендерера `nowrap`
превращается в настоящий `textAutoResize:'WIDTH_AND_HEIGHT'`, а не просто в
`layoutSizingHorizontal/Vertical:'HUG'` после `appendChild` — важно для
текста внутри Component/Instance, где override текста инстанса может быть
шире master и обязан раздвинуть узел, а не перенестись.

`node.fills` для текстового узла — CSS `color` (цвет глифов), НЕ
`background-color` (у Figma TextNode нет фона в отличие от frame). Если у
такого узла при этом задан непрозрачный `background-color` — он теряется,
но не молча: diagnostic `text-background-dropped`.

Смешанный контент (текст вперемешку с инлайновыми тегами форматирования,
напр. `<p>Some <b>x</b> text</p>`) становится ЕДИНЫМ текстовым узлом со
стилизованными диапазонами (`DesignNode.textRuns`), если ВСЕ вложенные
элементы — "чисто инлайновые" теги (`B/STRONG/I/EM/U/S/STRIKE/SPAN/A/SMALL/
MARK/SUB/SUP/CODE/ABBR/CITE/Q/TIME/LABEL`, `BR` → `\n`). Если среди
вложенных попался НЕ инлайновый тег (картинка, блочный элемент — Figma
TextNode не умеет встроенные картинки внутри текста) — старое поведение:
вложенные элементы конвертируются как обычно, каждый сам по себе; "голый"
текст вокруг них ("Some "/" text") теряется с diagnostic
`mixed-inline-text-not-captured`.

## Canvas/WebGL

Не реконструируются. Снимаются как raster snapshot (`toDataURL`/CDP
`Page.captureScreenshot` с clip по bounding box) → `DesignAsset{kind:'raster'}`
+ обязательный `ConversionWarning{severity:'info', code:'canvas-rasterized'}`.

## Распознавание компонентов — только opt-in, не часть обычного импорта

Обычный Import as Frame/Apply to Selection **никогда** не превращает
повторяющиеся структуры в Figma Component/Instance автоматически — эта
эвристика существует только в отдельном read-only инвентаре ("Компоненты"
вкладка, см. `docs/architecture.md`), не в `convertElement.ts`. Правила
распознавания (`detectComponentCandidates()` в `packages/conversion-engine/
src/componentGroups.ts`), для справки — сравниваются кандидаты (прямые
соседи одного родителя):

- **Структурная сигнатура**: тег + семантический (не-utility) класс + набор
  layout/decoration computed-style свойств (`display`, `flex-*`, `gap`,
  `padding-*`, `border-*`, `box-shadow`, `animation-name`) + рекурсивная
  сигнатура детей. Текстовые листья схлопываются в одну сигнатуру `'text'` —
  содержимое текста не участвует в сравнении структуры.
- **Совместимость геометрии** (`hasCompatibleGeometry`) — размеры (±6% или
  ±2px, что больше) должны совпадать рекурсивно по всем детям, **кроме
  текстовых листьев** — глифовый бокс текста намеренно НЕ сравнивается:
  карточки с одинаковой структурой, но подписями разной длины ("Orders" vs
  "Financial and procurement activity"), это всё ещё одна семья компонентов.
- Отсеиваются: элементы < 16×12px, элементы с `animation-name !== none`
  (бесконечные marquee/карусели — реализационные детали, не переиспользуемые
  UI-компоненты), элементы шире 1.8× родителя.
- Итоговая `confidence` (0.72..0.99) растёт с числом инстансов и наличием
  семантического класса — не используется для отсева, только для сортировки
  карточек в панели.

Это НЕ то же самое, что legacy `detectComponentGroups()` (мёртвый код,
только для чтения старых документов с `componentRef` — `hasUnsafeText
GeometryOverride()` там, наоборот, СРАВНИВАЕТ текстовые боксы и блокирует
группировку при расхождении >0.5px, чтобы не сломать character override
внутри Component/Instance). Два похожих по духу, но разных по критерию
геометрии прохода — не путать при чтении кода.

## Confidence score (Import Quality)

Реализовано (Phase 11, `packages/conversion-engine/src/confidence.ts`):
`computeConfidenceScore(diagnostics)` = `100 - Σpenalty`, clamp `[0, 100]`,
где `penalty` по `severity`: `info`→2, `warning`→8, `error`→20 (простая сумма
фиксированных штрафов за каждый diagnostic, не мультипликативная формула —
типичная "чистая" карточка/лендинг с 0-1 info-диагностикой держится в
"high" ≥80%). `confidenceLevel(score)`: `high` ≥80 / `medium` ≥50 / `low` <50.
Это не научная метрика точности реконструкции — быстрый ориентировочный
сигнал "насколько доверять результату с первого взгляда", не заменяющий сам
список диагностик (Inspector Panel показывает и то, и другое рядом).

## Allowlist computed-стилей, которые реально читаются из CDP

Не весь `CSS.getComputedStyleForNode` (300+ свойств) — только то, что имеет
представление в модели (`packages/design-ast`):

```
display, position, flex-direction, flex-wrap, justify-content, align-items,
gap, row-gap, column-gap, padding-*, margin-* (только для block-inference),
width, height, min-width, min-height, max-width, max-height,
background-color, background-image, background-size, background-position,
border-*-width, border-*-color, border-*-style, border-radius,
box-shadow, opacity, transform,
font-family, font-size, font-weight, line-height, letter-spacing,
text-align, text-transform, text-decoration, color,
overflow, overflow-x, overflow-y,
grid-template-columns, grid-template-rows, grid-auto-flow,
object-fit, mask-image
```

Список закрытый и версионируется вместе с этим документом — расширяется по
мере необходимости конкретных fixtures, не "на всякий случай".
