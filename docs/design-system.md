# Design System — референс Skill-tree и адаптация

Этот документ фиксирует, что было изучено в `SWYOD/Skill-tree` (Electron + React
десктоп-приложение, https://github.com/SWYOD/Skill-tree) перед проектированием UI
`web-to-figma`, что из него переиспользуется буквально, что адаптируется, и что
сделано иначе — и почему.

## 1. Стек, на котором построен Skill-tree

- **electron-vite** (не webpack) — main/preload/renderer в одной конфигурации,
  единый dev-server с HMR для renderer.
- **React 18**, без каких-либо UI-фреймворков (ни MUI, ни Tailwind) — весь UI
  на ручном CSS с BEM-подобными плоскими классами (`.tb-btn`, `.icon-btn`,
  `.panel-title` и т.д.) в одном `styles.css`.
- **zustand** — стор приложения (`treeStore.ts`), простой, без middleware-зоопарка.
- **lucide-react** — единственный источник иконок.
- **framer-motion** — точечно, для анимаций графа/попапов.
- IPC: `contextBridge.exposeInMainWorld('api', api)` в preload, типизированный
  интерфейс `Api` в `shared/types.ts`, `ipcMain.handle` на каждый запрос —
  никакого `any`, никакого `ipcRenderer.send` "в пустоту" без ответа.

**Решение**: `web-to-figma` использует тот же набор технологий один в один —
electron-vite, React 18 (строгий TS), zustand, lucide-react. Это не только
следование референсу, но и объективно подходящий стек для инструмента
разработчика с похожей формой (toolbar + resizable панели + канвас).

## 2. Тема: архитектура

Skill-tree применяет тему **не через CSS-классы**, а через инлайновые
CSS custom properties на `document.documentElement.style` (`themes/apply.ts →
applyThemeVars`). Это позволяет:

- хранить темы как обычные JSON-объекты (в т.ч. пользовательские/импортированные),
  а не хардкодить их в CSS;
- переключать тему в рантайме без перезагрузки;
- рендерить один и тот же граф/превью в теме, отличной от текущей темы
  интерфейса (см. `themeVarsStyle` — те же переменные, но как inline style
  локального wrapper'а, а не мутация `:root`).

### Набор токенов (`ThemeVars`)

```
bg, bg-panel, bg-graph,
surface, surface-2,
hover,
border, border-strong,
text, text-dim, text-faint,
accent, accent-soft, accent-text (опционален, с фолбэком),
danger,
shadow
```

Плюс размерные токены, заданные один раз в `styles.css` и не входящие в тему:
`--radius: 10px`, `--radius-lg: 14px`.

### Light/Dark/System

У Skill-tree это не "две независимые темы", а **`altVariant`** — второй,
контрастный по яркости вид **той же** темы (та же семантика, инвертированные
значения), переключаемый тумблером, а не выбором из галереи. `effectiveVariant(theme,
mode)` возвращает `vars`/`branchColors` в зависимости от `mode: 'primary' | 'alt'`.

**Как это переносится в `web-to-figma`**: у нас нет пользовательской галереи тем
(не нужна для инструмента разработчика) — но сама механика "одна семантическая
палитра, два инвертированных набора значений + примитив, который резолвит
эффективный вариант" переносится напрямую, только `mode` расширяется до
`'light' | 'dark' | 'system'` (третье значение резолвится в `light`/`dark` через
`window.matchMedia('(prefers-color-scheme: dark)')`, с подпиской на его
`change`). Это отдельный пакет `packages/ui/src/theme`, портированный из
`theme.ts` + `themes/apply.ts`, без веток/иконок/галереи тем (нерелевантны для
этого продукта).

## 3. Композиция экрана

```
.app (flex column, 100vh)
 ├─ .toolbar (52px, flex row, justify-between, border-bottom)
 └─ .workspace (flex row, flex:1, padding:10px, gap:0)
     ├─ .col (карточка: border + border-radius-lg + surface + shadow)
     ├─ .resizer (10px, drag через pointer capture)
     ├─ .col.center-col (flex:1, фоном bg-graph, а не surface)
     └─ .col (правая панель)
```

Панели — не сплошной сайдбар на весь экран (как в вебе), а **карточки с
отступом от края окна и собственной рамкой/тенью** ("панели-карточки как в
Claude Desktop", дословно из комментария в styles.css). Это ключевая
визуальная подпись Skill-tree, которую стоит унаследовать буквально.

**Как это переносится**: `web-to-figma` использует ту же структуру —
`Toolbar` (адресная строка вместо brand/дерева) + `.workspace` с тремя
колонками: `LeftRail`/browser-панель нет как таковой (левая панель не нужна —
нет дерева), центр — `.col.center-col` с браузером (в Phase 2), справа —
`.col` с Inspector Panel, шириной по умолчанию 360px, resizable в тех же
границах (`260–560`).

## 4. Переиспользуемые компоненты — что взято как есть

Перенесены и адаптированы (без строчного копирования, но 1:1 по CSS-логике
и API компонента):

| Компонент Skill-tree | Файл | Судьба в `web-to-figma` |
|---|---|---|
| `Switch.tsx` | `components/Switch.tsx` | Взят как есть (`role="switch"`, `aria-checked`, `.switch`/`.switch-thumb`) → `packages/ui/src/Switch.tsx` |
| `.tb-btn` / `.tb-btn.primary` / `.icon-btn` | `styles.css` | Токены и модификаторы перенесены как CSS-классы `packages/ui` → `ToolbarButton`, `IconButton` |
| `.segmented` / `.seg` | `styles.css` | Перенесено как `Segmented` — нужен для переключателя Light/Dark/System и для будущих режимов (Element/Assets) |
| `.col` / `.panel` / `.panel-head` / `.panel-title` | `styles.css` | Перенесено как `Panel`/`PanelHeader` — основа Inspector Panel |
| `.settings-popup` (floating popover у кнопки, не modal) | `styles.css`, `SettingsPanel.tsx` | Перенесено как `Popover` — под меню темы/настроек в toolbar |
| `.modal` / `.modal-backdrop` | `styles.css` | Перенесено как `Modal` — под будущие диалоги (Apply to Selection, Import Quality detail) |
| Scrollbar styling (`*::-webkit-scrollbar`) | `styles.css` | Перенесено дословно (тонкий скролл, `--border-strong`/`--text-faint`) |
| `resizer` (pointer-capture drag) | `App.tsx` | Перенесено как хук `useResizer` в `packages/ui` |

Не переносится: граф/дерево-специфичные вещи (`GraphCanvas`, `NodeGlyph`,
`BranchIcon`, `MiniSkillGraph`, чек-листы, markdown-редактор, экспорт PNG) —
нерелевантны продукту.

## 5. Типографика и плотность

- Шрифт: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
  sans-serif` — с тем же fallback-хвостом (`FONT_FALLBACK_TAIL`).
- Базовый размер текста: `13.5px`, `line-height: 1.45`.
- Заголовки секций панели: `11px`, `uppercase`, `letter-spacing: 0.9px`,
  цвет `--text-faint`, `font-weight: 600` (см. `.panel-title`, `.block-head`).
- Кнопки тулбара: `32px` высота, `13px` текст, `border-radius: 9px`.
- Основной радиус контролов: `9px`; радиус карточек/панелей: `--radius-lg` =
  `14px`; радиус мелких элементов (чипы, свотчи): `6–8px`.

`web-to-figma` наследует эти значения без изменений — это прямой перенос
токенов из `styles.css`, а не переизобретение.

## 6. Стилевые паттерны, важные для Inspector Panel

`.block` / `.block-head` (плоские секции внутри панели, разделённые
`border-bottom`, без вложенных карточек) — ровно то, что нужно для
структуры Inspector Panel из ТЗ (`Layout` / `Typography` / `Fill` / `Radius`
/ `Border` / `Shadow` / `Assets` / `Import quality`, каждая — свой `.block`).
Переносится напрямую.

`swatch`/`swatches` (цветовые кружки с активным состоянием через `box-shadow:
0 0 0 2px currentColor`) годится для отображения `fills`/`branch colors`
дизайн-токенов сайта в Phase "Design Token Extraction" — решение отложено,
но паттерн уже есть в `packages/ui` на будущее.

## 7. Явные отличия `web-to-figma` от Skill-tree (и почему)

1. **Нет пользовательской галереи тем / кастомных шрифтов.** Skill-tree — это
   персонализируемый личный инструмент, `web-to-figma` — рабочий инструмент
   разработчика/дизайнера с фиксированной, предсказуемой темой (Light/Dark +
   System). Кастомизация здесь не продуктовая ценность, а лишняя поверхность.
2. **Нет отдельной "AMOLED"/"Synthwave"/"Discord" палитры.** Взята только
   структура токенов и *одна* пара light/dark, спроектированная заново под
   рабочий инструмент (нейтральная, низкий шум, акцент — фиолетовый `#8b5cf6`,
   тот же, что дефолтный accent Skill-tree — для визуальной преемственности
   "той же экосистемы").
3. **Нет `branchColors`.** Это специфика скилл-дерева (цвет ветки), в
   `web-to-figma` есть свой набор семантических цветов (info/warning/error для
   Import Quality diagnostics), не связанный с этим механизмом.
4. **Toolbar = адресная строка браузера**, а не brand+дерево — по смыслу
   продукта, но высота (52px), паддинги и `.tb-btn`/`.tb-sep` — те же.

## 8. Итог: что конкретно лежит в `packages/ui`

```
packages/ui/src/
  theme/
    tokens.ts        — ThemeVars (типы токенов), перенос ThemeVars из Skill-tree
    palette.ts        — light/dark палитра web-to-figma (аналог builtins.ts, одна пара)
    ThemeProvider.tsx  — Light/Dark/System, matchMedia-подписка, applyThemeVars
    apply.ts           — applyThemeVars/effectiveVariant, портировано из themes/apply.ts
  primitives/
    Switch.tsx
    IconButton.tsx
    ToolbarButton.tsx
    Segmented.tsx
    Panel.tsx           (Panel/PanelHeader/PanelTitle/Block/BlockHead)
    Popover.tsx
    Modal.tsx
  hooks/
    useResizer.ts
  styles/
    tokens.css          — :root дефолты (аналог верхнего блока styles.css)
    base.css             — сброс, scrollbar, типографика
    components.css        — .tb-btn/.icon-btn/.segmented/.panel/... классы
```

Компонентная библиотека — обычные CSS-классы + инлайн CSS-переменные (та же
техника, что в Skill-tree), **не** CSS-in-JS и не Tailwind — чтобы не тащить
рантайм-зависимость, которой в референсе нет.
