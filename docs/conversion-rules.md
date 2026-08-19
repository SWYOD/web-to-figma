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
| `gap` | `itemSpacing` |
| `row-gap`/`column-gap` (если различаются) | Figma Auto Layout не поддерживает разные gap по осям до недавних версий с `layoutWrap` — при расхождении: warning + берём `row-gap` как основной (визуально доминирует в большинстве карточных layout), `column-gap` теряется с явным диагностическим сообщением |
| `padding` | `padding{Top,Right,Bottom,Left}` |
| `justify-content: flex-start/center/flex-end` | `primaryAxisAlignItems` прямое соответствие |
| `justify-content: space-between` | Нет прямого аналога в Auto Layout → fallback: `primaryAxisAlignItems:'SPACE_BETWEEN'` (Figma это поддерживает начиная с относительно новых версий API) — если недоступно в целевой версии API, fallback на `'MIN'` + warning |
| `justify-content: space-around/evenly` | Нет аналога вообще → `'MIN'` + explicit warning `code: 'justify-content-approximated'` |
| `align-items` | `counterAxisAlignItems` прямое соответствие (`stretch→STRETCH`, `center→CENTER`, ...) |
| `flex-grow > 0` на ребёнке | `layoutGrow: 1` |
| `flex-wrap: wrap` | `layoutWrap: 'WRAP'` (если целевая Figma API версия поддерживает); иначе warning + без wrap |
| Явные `width`/`height` (px) | `widthSizing:'fixed'`/`heightSizing:'fixed'` |
| `width: auto` при flex-child, размер определяется контентом | `hug` |
| `width: 100%`/`flex: 1` относительно родителя-flex | `fill` |

## CSS Grid

Grid переносится в Figma Grid **только если** структура укладывается в его
модель без потерь (равные колонки/строки, простой `gap`, без именованных
областей и сложных `grid-template-areas`). Проверяется до конвертации —
если структура "неровная" (разное число колонок в разных местах, `span`,
`auto-fit`/`auto-fill` с нетривиальным `minmax`), используется fallback:
рендер как `layoutMode:'GRID'`-эмуляция через вложенные Auto Layout
horizontal-в-vertical (ряды из ячеек), с warning `code:
'grid-approximated-as-nested-autolayout'`.

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

`node.fills` для текстового узла — CSS `color` (цвет глифов), НЕ
`background-color` (у Figma TextNode нет фона в отличие от frame). Если у
такого узла при этом задан непрозрачный `background-color` — он теряется,
но не молча: diagnostic `text-background-dropped`.

Смешанный контент (текст вперемешку с вложенными тегами, напр.
`<p>Some <b>x</b> text</p>`) НЕ становится единым текстовым узлом со
стилизованными диапазонами (нужна отдельная модель "текст с разными стилями
внутри одного узла" — не реализовано). Вместо этого: вложенные элементы
(здесь `<b>`) конвертируются как обычно, каждый сам по себе (если сам `<b>` —
чистый текстовый лист, он тоже станет `type:'text'`); "голый" текст вокруг
них ("Some "/" text") теряется с diagnostic `mixed-inline-text-not-captured`.

## Canvas/WebGL

Не реконструируются. Снимаются как raster snapshot (`toDataURL`/CDP
`Page.captureScreenshot` с clip по bounding box) → `DesignAsset{kind:'raster'}`
+ обязательный `ConversionWarning{severity:'info', code:'canvas-rasterized'}`.

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
