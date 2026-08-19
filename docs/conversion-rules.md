# DOM/CSS → Figma Layout: правила конверсии

**Статус: direction document.** Описывает согласованные правила для
`conversion-engine` (Phase 5-8). Реализация ещё не начата в Phase 1 — этот файл
существует, чтобы решения были зафиксированы до кода, а не изобретались по
ходу дела.

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

## Canvas/WebGL

Не реконструируются. Снимаются как raster snapshot (`toDataURL`/CDP
`Page.captureScreenshot` с clip по bounding box) → `DesignAsset{kind:'raster'}`
+ обязательный `ConversionWarning{severity:'info', code:'canvas-rasterized'}`.

## Confidence score (Import Quality)

Эвристика (Phase 11, не блокирует более ранние фазы): каждый `ConversionWarning`
имеет вес по `severity` (`info`→0, `warning`→1, `error`→3). Score документа =
`100 - min(100, Σweights * k)`, `k` подбирается так, чтобы типичная "чистая"
карточка/лендинг без warning давал 100%, а страница с десятком approximation-
warning'ов — заметно ниже (ориентир: 5 warning уровня `warning` → ~85-90%).
Точная формула фиксируется вместе с реализацией Phase 11 на реальных fixtures,
не задаётся здесь произвольно.

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
