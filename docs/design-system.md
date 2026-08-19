# Design System — референс Skill-tree и адаптация

Этот документ фиксирует, что было изучено в `SWYOD/Skill-tree` (Electron + React
десктоп-приложение, https://github.com/SWYOD/Skill-tree) перед проектированием UI
`web-to-figma`, что из него переиспользуется буквально, что адаптируется, и что
сделано иначе — и почему.

> **Реверс решения (см. §7.1–7.2).** Изначально §3 и §7 этого документа
> фиксировали решение НЕ иметь левый сайдбар и НЕ иметь галерею/редактор тем
> ("web-to-figma — инструмент с фиксированной темой, кастомизация не
> продуктовая ценность"). Пользователь явно попросил обратное — левый сайдбар
> с историей посещённых сайтов и кнопкой настроек внизу, плюс галерея и
> редактор тем, портированные из Skill-tree. Это осознанный реверс по прямому
> запросу пользователя (не пересмотр решения "по факту" самим агентом) — §3 и
> §7 ниже обновлены и объясняют текущее состояние и причину изменения.

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
     ├─ .col (левый сайдбар — LeftSidebar, resizable 200–480, по умолчанию 260)
     ├─ .resizer (10px, drag через pointer capture)
     ├─ .col.center-col (flex:1, фоном bg-canvas, а не surface)
     ├─ .resizer
     └─ .col (правая панель — Inspector, resizable 260–560, по умолчанию 360)
```

Панели — не сплошной сайдбар на весь экран (как в вебе), а **карточки с
отступом от края окна и собственной рамкой/тенью** ("панели-карточки как в
Claude Desktop", дословно из комментария в styles.css). Это ключевая
визуальная подпись Skill-tree, которую стоит унаследовать буквально.

**Как это переносится**: `web-to-figma` использует ту же структуру —
`Toolbar` (brand + сворачивание левой/правой панели слева/справа от секций,
`BridgePopover` в `toolbar-right`) + `.workspace` с ТРЕМЯ колонками: слева
`LeftSidebar` (реверс §7.1 — история недавних сайтов + настройки, добавлено
по прямому запросу пользователя), центр — `.col.center-col` с браузером,
справа — `.col` с Inspector Panel. Обе боковые панели сворачиваются кнопками
`PanelLeft`/`PanelRight` в toolbar (тот же паттерн, что `leftOpen`/`rightOpen`
в `App.tsx` Skill-tree), центр всегда занимает освободившееся место.

Element picker запускается не кнопкой в шапке Inspector Panel, а плавающим
пилл-тулбаром (`PickerFloatBar`) поверх браузерной области снизу-по-центру, в
духе Figma — см. `.browser-viewport-wrap`/`.picker-float-bar` в
`apps/desktop/src/renderer/src/styles.css`: `.browser-viewport` (источник
bounds для нативного `WebContentsView`, см. `architecture.md` §6.8) намеренно
не доходит до низа контейнера, оставляя HTML-полосу под бар, иначе нативный
слой браузера перекрыл бы его.

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

1. **Галерея тем и редактор темы — ЕСТЬ** (реверс исходного решения "нет
   пользовательской галереи тем", см. врезку в начале документа). Пользователь
   явно попросил перенести `ThemesPopup`/`ThemeCard`/`ThemeEditor` Skill-tree в
   `web-to-figma`, трактуя приложение как более персонализируемое, чем
   изначально заложено в scope — "рабочий инструмент с фиксированной темой"
   было продуктовым решением на момент Phase 1, а не техническим ограничением,
   и пользователь вправе его пересмотреть. Перенесено:
   - `packages/ui/src/theme/tokens.ts` — `ThemeDef`/`ThemeVariant` (реестр тем),
     без `branchColors`/`font`/graph-полей (см. п.3 ниже — этой специфики
     по-прежнему нет и не появилось).
   - `packages/ui/src/theme/builtins.ts` — `BUILTIN_THEMES`: прежняя
     единственная пара `DARK_VARS`/`LIGHT_VARS` (`palette.ts`) стала первой
     записью реестра (`id: 'default'`), плюс 4 темы, портированные из
     Skill-tree (GitHub Dark, Dracula, Linear, Discord) — остальные
     (Synthwave, Nuxt UI, Claude Desktop) сознательно не портированы, не
     показались явно уместными для дев-инструмента. `bg-graph` (нет графа в
     этом продукте) ремаппнут на `bg-canvas` (фон браузерной области — тот же
     смысл "холста"). `warning`/`info`/`success` — токенов, которых не было у
     Skill-tree (не диагностический инструмент) — у каждой встроенной темы НЕ
     подобраны индивидуально, а взяты из одной общей пары (диагностические
     цвета дефолтной темы), т.к. это цвета северности диагностики Import
     Quality, а не брендовые цвета темы, и не должны скакать при смене темы.
   - `apps/desktop/src/renderer/src/components/ThemeCard.tsx`,
     `ThemesGalleryModal.tsx`, `ThemeEditorModal.tsx` — портированы из
     `ThemeCard.tsx`/`ThemesPopup.tsx`/`ThemeEditor.tsx` Skill-tree. Превью
     (карточка и полный `ThemePreviewMock` в редакторе) НЕ рисуют
     `MiniSkillGraph` (нет графа) — вместо этого мини-макет РЕАЛЬНОГО shell'а
     этого приложения (toolbar + сайдбар + браузерная область + панель), та же
     идея "каждый токен виден на узнаваемом элементе", другой силуэт.
   - **Отложено, не перенесено**: JSON-импорт/экспорт темы (`window.api.importJson`/
     `exportJson` в Skill-tree) — потребовал бы Electron `dialog`+fs-плечо ради
     редкого сценария, сознательно вне scope этой итерации. `isValidThemeDef`
     (валидация формы темы) при этом перенесена и используется — защищает
     `customThemes` из `settings.json` от порчи вручную/при миграции, не только
     от файлового импорта.
2. **Один общий набор темы, без `branchColors`.** Взята структура токенов
   Skill-tree, но у `web-to-figma` собственный набор семантических цветов
   (`warning`/`info`/`success`/`danger` для Import Quality diagnostics),
   не связанный с механизмом веток (которых у продукта нет — см. п.3).
3. **Нет `branchColors` и кастомных шрифтов.** Это специфика скилл-дерева
   (цвет ветки) и системы шрифтов Skill-tree — ни то, ни другое не появилось
   при переносе галереи тем; `ThemeEditorModal` сознательно не имеет поля
   шрифта.
4. **Toolbar = brand + сворачивание боковых панелей**, а не adress-bar
   Skill-tree'шного дерева — по смыслу продукта, но высота (52px), паддинги и
   `.tb-btn`/`.tb-sep` — те же. Light/Dark/System (`Segmented`) раньше жил в
   toolbar — теперь перенесён в попап настроек (`SettingsPopover`) левого
   сайдбара, вместе с выбором темы (см. п.1) — `toolbar-right` держит только
   `BridgePopover` и переключатель правой панели.
5. **Левый сайдбар — ЕСТЬ** (реверс исходного решения "нет сайдбара", см.
   врезку в начале документа). Аналога в Skill-tree нет (там дерево навыков) —
   спроектирован с нуля под смысл ЭТОГО продукта: история недавно посещённых
   сайтов embedded-браузера (клик — навигация назад на этот URL), персистится
   в `recent-sites.json` (userData, тот же паттерн, что `settings.json`), живёт
   в отдельном `main/recentSites.ts` (fs/IPC-агностик, как `BrowserController`/
   `ElementPicker`) и обновляется live через `recent-sites:updated`. Визуальная
   форма (`.panel.left-panel` → шапка → скроллящийся список →
   `.settings-anchor` внизу) взята буквально из `LeftPanel.tsx` Skill-tree —
   именно этот структурный паттерн, не конкретное дерево-содержимое.

## 8. Итог: что конкретно лежит в `packages/ui`

```
packages/ui/src/
  theme/
    tokens.ts        — ThemeVars/ThemeVariant/ThemeDef (типы токенов + реестр тем)
    palette.ts        — DARK_VARS/LIGHT_VARS — исходная пара, теперь vars темы 'default'
    builtins.ts        — BUILTIN_THEMES/DEFAULT_THEME(_ID) — реестр встроенных тем (см. §7.1)
    ThemeProvider.tsx  — Light/Dark/System + themeId/customThemes, applyThemeVars
    apply.ts           — resolveTheme/effectiveVariant/applyThemeVars/isValidThemeDef
  primitives/
    Switch.tsx
    IconButton.tsx
    ToolbarButton.tsx
    Segmented.tsx
    Panel.tsx           (Panel/PanelHeader/PanelTitle/Block/BlockHead)
    Popover.tsx          (placement: 'down' | 'up-stretch' — см. §7.5)
    Modal.tsx
  hooks/
    useResizer.ts
  styles/
    tokens.css          — :root дефолты (аналог верхнего блока styles.css)
    base.css             — сброс, scrollbar, типографика
    components.css        — .tb-btn/.icon-btn/.segmented/.panel/.settings-*/.theme-*/... классы

apps/desktop/src/renderer/src/components/  (специфично для этого приложения, не в packages/ui)
  LeftSidebar.tsx      — левый сайдбар: история сайтов + SettingsPopover (см. §7.5)
  SettingsPopover.tsx   — попап настроек (Темы + Light/Dark/System), см. §7.4
  ThemeCard.tsx         — карточка темы в галерее, превью-макет этого shell'а (см. §7.1)
  ThemesGalleryModal.tsx — модалка "Темы" (грид карточек + кнопка редактора)
  ThemeEditorModal.tsx  — редактор темы (форма по токену + живой превью-макет)
  PickerFloatBar.tsx    — плавающий пилл над браузерной областью (запуск picker'а, см. §3)

apps/desktop/src/main/
  recentSites.ts        — RecentSitesStore: история сайтов, fs-персистенция, live-обновления
```

Компонентная библиотека — обычные CSS-классы + инлайн CSS-переменные (та же
техника, что в Skill-tree), **не** CSS-in-JS и не Tailwind — чтобы не тащить
рантайм-зависимость, которой в референсе нет.
