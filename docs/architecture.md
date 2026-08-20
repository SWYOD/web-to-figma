# Архитектура

## 1. Обзор

```
Electron Desktop App (apps/desktop)
        │
        ├── Chromium Browser (WebContentsView, Phase 2)
        ├── DOM/CSS Inspector (CDP: DOM, CSS, Runtime, DOMSnapshot, Page, Network — Phase 3-4)
        ├── Asset Inspector (Phase 9)
        ├── Conversion Engine (packages/conversion-engine) — DOM/CSS → Design AST
        ├── Inspector UI (apps/desktop/src/renderer)
        └── Bridge client (packages/bridge-protocol, WebSocket)
                 │
                 │ ws://127.0.0.1:<port>  (desktop = server, plugin UI = client)
                 ▼
          Figma Plugin (apps/figma-plugin)
                 ├── UI iframe (bridge client, тонкий UI статуса/действий)
                 └── main sandbox (code.ts) — Design AST → Figma Nodes, Assets → Figma Assets
```

## 2. Технологический стек и почему

| Слой | Технология | Почему |
|---|---|---|
| Desktop runtime | **Electron** (не Tauri) | CDP и полноценный Chromium — часть продукта, не побочный эффект. Tauri со своим WRY/системным webview не даёт стабильного CDP-доступа ко вкладке на всех платформах. |
| Встроенный браузер | `WebContentsView` | `BrowserView` deprecated с Electron 29 в пользу `WebContentsView` (первый класс в Chromium Views API, меньше кода на bounds/resize). Источник: electronjs.org/blog/migrate-to-webcontentsview. |
| Инспекция DOM/CSS | `webContents.debugger` (CDP) | Официальный способ Electron говорить с Chrome DevTools Protocol без второго процесса Chrome и без хрупких инъекций больших JS-скриптов поверх произвольного сайта (может ломаться CSP/сайтовым JS). |
| UI (desktop + plugin) | React 18 + TypeScript strict | Соответствует референсу Skill-tree, см. `design-system.md`. |
| Сборка desktop | electron-vite + Vite | Тот же инструмент, что в Skill-tree — единая конфигурация main/preload/renderer, HMR. |
| Сборка figma-plugin | esbuild (code.ts) + Vite + vite-plugin-singlefile (ui.html) | Figma грузит `ui` как один self-contained HTML файл (`figma.showUI(__html__)`) — нужен single-file бандл; `code.ts` — обычный CJS/IIFE бандл под sandbox Figma. |
| Состояние | zustand | Как в Skill-tree — простой стор без лишней архитектуры. |
| Bridge-транспорт | WebSocket (`ws` на стороне desktop-сервера, нативный `WebSocket` в plugin UI) | Локальный, быстрый, двунаправленный, не требует сериализации через файлы/HTTP polling. |
| Валидация протокола | zod | Runtime-валидация сообщений на обеих границах процесса (desktop↔plugin) — граница, которую нельзя проверить только типами TS. |
| Monorepo | pnpm workspaces + Turborepo | Несколько взаимозависимых пакетов (`design-ast`, `conversion-engine`, `asset-engine`, `bridge-protocol`, `ui`), которые нужно инкрементально собирать и типизировать из `apps/*` в dev-режиме — Turborepo даёт pipeline с кэшем без лишней инфраструктуры (не Nx: не нужны генераторы/плагины, не нужен монолитный конфиг). |

## 3. Структура репозитория

```
apps/
  desktop/              — Electron-приложение (main/preload/renderer)
  figma-plugin/          — Figma Plugin (main sandbox + UI iframe)

packages/
  design-ast/            — платформонезависимая модель дизайна (DesignNode/DesignDocument)
  conversion-engine/     — DOM/CSS → Design AST; НЕ зависит от Electron/CDP/Figma
  asset-engine/          — извлечение/дедупликация/хэширование assets; НЕ зависит от Figma
  bridge-protocol/       — типизированный контракт desktop ⇄ figma-plugin (zod)
  shared/                — общие примитивы без побочных зависимостей (result-типы, id, логгер-интерфейс)
  ui/                    — React-компоненты и тема (см. design-system.md)

docs/                    — этот и смежные документы
```

### Границы зависимостей (важно, зафиксировано намеренно)

- `conversion-engine` **не импортирует** ничего из Electron (`electron`, `webContents`) и ничего из Figma Plugin API (`figma.*`). На вход — нормализованные снапшоты DOM/CSS (простые данные, см. `conversion-rules.md`), на выход — `DesignDocument` из `design-ast`. Это позволяет тестировать его в Node без Electron/Figma вообще (см. fixtures в п.32 исходного ТЗ).
- `asset-engine` не импортирует `figma.*`. На вход — сырые байты/URL/hash-input, на выход — `DesignAsset[]`. Он тоже тестируется в изоляции.
- `bridge-protocol` не импортирует ни Electron, ни Figma API — только `zod` и типы. Используется как зависимость с обеих сторон моста.
- Electron-специфичный код (CDP-обёртка, `webContents.debugger`, `WebContentsView`) живёт только в `apps/desktop/src/main`, за интерфейсом (`packages/shared` описывает контракты типа `InspectorSnapshotSource`, конкретную CDP-реализацию только `apps/desktop` знает).
- Figma Plugin API (`figma.createFrame`, `figma.createComponent`, ...) изолирован в `apps/figma-plugin/src/main/renderers/*` — эти модули знают про `DesignNode`, но `design-ast` не знает про `SceneNode`.

## 4. Bridge: кто сервер, кто клиент

**Desktop app поднимает локальный WebSocket-сервер** (`127.0.0.1`, фиксированный
дефолтный порт с fallback-перебором при занятости, см. `bridge-protocol.md`).
Figma Plugin UI (iframe в контексте `figma.showUI`) подключается как клиент.

Почему не наоборот: desktop-приложение — долгоживущий процесс с понятным
жизненным циклом (запущено/не запущено), а Figma Plugin запускается/
останавливается пользователем многократно за сессию и не может держать порт.
Серверу проще быть тем участником, что живёт дольше.

`networkAccess.allowedDomains` в `manifest.json` плагина обязан явно перечислять
`ws://127.0.0.1:<port>` (и через `devAllowedDomains` — то же для локальной
разработки), иначе Figma заблокирует запрос на сетевом уровне.

## 5. Design AST как граница conversion-engine ⇄ Figma renderer

`conversion-engine` не создаёт Figma-узлы напрямую. Он производит
`DesignDocument` (см. `design-ast.md`), который бридж пересылает в plugin,
а рендерер в `apps/figma-plugin/src/main` превращает в `SceneNode`. Это
даёт три вещи: (1) `conversion-engine` тестируется без Figma; (2) один и тот же
AST можно в будущем рендерить иначе (например, экспорт в другой инструмент);
(3) diagnostics/confidence score считаются на AST, до всякого контакта с Figma
API.

## 6. Технические риски (зафиксированы для последующих фаз)

1. **CDP-снапшот больших страниц.** `DOM.getDocument(depth: -1)` на тяжёлых
   SPA может быть избыточным — Phase 3/4 должны собирать поддерево лениво
   (по клику/hover), не весь документ сразу.
2. **`computed style` explosion.** Каждый узел CDP `CSS.getComputedStyleForNode`
   отдаёт ~300+ свойств — конверсии нужен явный allowlist релевантных для
   реконструкции свойств (см. `conversion-rules.md`), а не бездумная выгрузка.
3. **CORS/CSP при скачивании assets.** Desktop-процесс качает assets сам
   (не Figma Plugin — у Figma Plugin ограниченный `networkAccess`), но сайт
   может иметь CSP, блокирующий чтение `<img>`/`background-image` через
   `fetch` из контекста инспектируемой страницы — обходится через
   `Page.getResourceContent`/`Network.getResponseBody` в CDP (не через JS
   инъекцию `fetch`).
4. **Figma Auto Layout не 1:1 с Flexbox.** `justify-content: space-between`,
   `space-around`, `wrap` не имеют прямых аналогов в Auto Layout — нужны
   явные fallback-правила с warning, а не молчаливое приближение.
5. **Шрифты недоступны в Figma.** Решается конфигурируемым font-mapping +
   warning, см. п.21 исходного ТЗ — не блокер для Phase 1, но должно быть
   заложено в Design AST (`typography.fontFamily` как строка, а не enum).
6. **WebSocket и firewall/AV на Windows.** Локальный `127.0.0.1` обычно не
   триггерит файрвол, но описываем в `development.md` шаг troubleshooting.
7. **Нативные биндинги `ws` ломаются при бандлинге main-процесса Rollup'ом.**
   Обнаружено вживую при первом запуске Phase 1 milestone: `ws` опционально
   `require()`-ит нативные аддоны `bufferutil`/`utf-8-validate` для ускорения
   фрейминга; когда electron-vite/Rollup инлайнит `ws` прямо в `out/main/index.js`,
   их CJS-интероп ломается (`TypeError: bufferUtil2.unmask is not a function`,
   main-процесс падает сразу после старта). Решение — `apps/desktop/electron.vite.config.ts`
   держит `'ws'` в `build.rollupOptions.external` для main-конфига (runtime
   `require('ws')` вместо инлайна), при этом `ws` явно добавлен в
   `dependencies` `apps/desktop/package.json` (иначе Node не резолвит его из
   `out/main/`, т.к. pnpm не хойстит транзитивные зависимости по умолчанию).
   Остальные зависимости (включая ESM-only `nanoid`) специально **не**
   экстернализованы — main-процесс electron-vite собирает в CJS, а
   `require()` чистого ESM-пакета в CJS падает с `ERR_REQUIRE_ESM`; инлайн
   Rollup'ом эту проблему не имеет, т.к. сам конфликт возникает только у
   пакетов с нативными аддонами. **Урок на будущее**: любая новая зависимость
   main-процесса с нативными биндингами (например, будущий `sharp` для
   растеризации canvas/asset-обработки, если он появится) должна сразу
   проверяться на этот же класс проблемы и добавляться в `external`.
8. **`WebContentsView` всегда поверх HTML-слоя окна.** Это нативный
   композитный слой, а не DOM-элемент — он рисуется НАД React-UI внутри
   своего bounds-прямоугольника независимо от z-index. В Phase 2 это не
   создаёт проблем (browser area геометрически не пересекается с popover'ами
   toolbar'а), но Phase 3 (element picker) должен это учитывать: hover-рамка
   и bounding-box вокруг наведённого DOM-элемента, скорее всего, тоже придётся
   рисовать либо инъекцией overlay внутрь самой страницы (через CDP
   `Page.addScriptToEvaluateOnNewDocument`/`Runtime.evaluate`, поверх контента
   страницы, а не поверх WebContentsView снаружи), либо явно управлять
   bounds/видимостью view, а не полагаться на HTML-оверлей с высоким z-index —
   он будет перекрыт. См. `apps/desktop/src/main/browser.ts` (комментарий у
   класса `BrowserController`).
9. **Относительные импорты внутри пакетов `packages/*` обязаны быть с
   расширением `.js`.** Наступили на эти грабли трижды (bridge-protocol в
   Phase 1 — включая сам `index.ts`, откуда баг всплыл только в Phase 6 при
   первом прямом импорте пакета целиком, а не только `/server`; conversion-engine
   в Phase 5): `package.json` этих пакетов объявляет `"type": "module"`, и
   `tsc` компилирует `import { x } from './foo'` в JS дословно как есть — Node
   ESM-резолвер (в отличие от Rollup/Vite, которые терпимее) отказывается
   резолвить такой импорт без явного расширения (`ERR_MODULE_NOT_FOUND`). Билд
   через electron-vite/Vite этого не ловит (бандлер резолвит на этапе сборки,
   а не в рантайме Node), поэтому баг всплывает только при прямом `node
   dist/index.js` — и может прятаться в барузер-файле (`index.ts`), даже если
   все остальные файлы пакета исправлены. Правило: **все** относительные
   импорты в `src/` этих пакетов — с `.js` на конце (`from './foo.js'`), даже
   притом что сам файл называется `foo.ts`; при добавлении нового `packages/*`
   пакета первым делом grep на `from '\./[^']*'` без `.js` перед первым
   прямым `node`-тестом, не полагаясь на то, что typecheck/build через
   бандлер это поймают — не ловят.
10. **`@figma/plugin-typings` требует `blurType` у blur-эффектов.** Обнаружено
    typecheck'ом в Phase 6 (не документацией — актуальная версия тайпингов
    разошлась с тем, что можно было бы предположить по устаревшим примерам):
    `LAYER_BLUR`/`BACKGROUND_BLUR` в текущей версии — не единственный
    вариант `Effect`, а часть union `BlurEffectNormal | BlurEffectProgressive`,
    различаемого полем `blurType: 'NORMAL' | 'PROGRESSIVE'`. Урок: даже для
    Figma Plugin API, где обычно достаточно `@figma/plugin-typings`
    (обновляется вместе с реальным API), не полагаться на память/примеры из
    обучающих данных — типы меняются, и типизированный `tsc --noEmit` перед
    тем, как считать фичу готовой, — не формальность.
11. **`Overlay.setInspectMode` перехватывает mousemove до диспетчеризации в
    JS страницы.** Обнаружено вживую внешним CDP-скриптом при попытке
    заменить встроенный info-тултип picker'а на собственный, темизированный:
    пока `Overlay.setInspectMode({mode:'searchForNode'})` активен (клик по
    "Select element"), `document.addEventListener('mousemove', ...)`,
    инжектированный в страницу через `Runtime.evaluate`, не получает ни
    одного события — то же поведение, что не даёт странице реагировать на
    hover своим JS во время реального "Inspect element" в DevTools (Chromium
    забирает mousemove на уровне ниже обычной диспетчеризации, ради
    предсказуемого picking, не зависящего от JS сайта). Решение
    (`apps/desktop/src/main/hoverTooltip.ts` + `inspector.ts`): вместо
    mousemove-листенера — polling из main-процесса каждые 50мс
    (`screen.getCursorScreenPoint()` + `WebContentsView`-bounds → CDP
    `DOM.getNodeForLocation`), обновляющий уже установленный в странице
    тултип через короткие `Runtime.evaluate`. Тултип содержит тот же набор
    данных, что нативный DevTools-тултип (selector, размеры, секция
    Accessibility — Name/Role/Keyboard-focusable через
    `Accessibility.getPartialAXTree`), и привязан к верхней/нижней грани
    bounding-box'а элемента (`DOM.getBoxModel`), а не к позиции курсора —
    проверено вживую (реальное перемещение курсора пользователем + отдельный
    CDP-скрипт, напрямую вызывающий `DOM.getNodeForLocation`/`describeNode`/
    `getBoxModel`/`Accessibility.getPartialAXTree` на реальном элементе и
    сверяющий результат с тем, что строит tooltip-pipeline).
12. **Реверс продуктового решения: левый сайдбар + галерея/редактор тем добавлены
    по прямому запросу пользователя** (см. `design-system.md` §7, врезка в начале
    документа) — Phase 1 явно фиксировала обратное ("web-to-figma — инструмент с
    фиксированной темой, без сайдбара"). Технически это не потребовало ломать
    существующие границы из §3 (`conversion-engine`/`asset-engine`/`bridge-protocol`
    по-прежнему не знают про UI) — реестр тем (`ThemeDef`, `BUILTIN_THEMES`)
    целиком в `packages/ui`, ничего не утекло в `apps/desktop/src/main`. Один
    новый нюанс инвертировал существующее ограничение из п.8 выше: `WebContentsView`
    всегда рисуется НАД HTML своего bounds-прямоугольника — плавающий бар
    запуска element picker'а (`PickerFloatBar`, замена кнопки в шапке Inspector
    Panel) решает эту же задачу, что предсказывал п.8, явно исключая полосу
    внизу `.browser-viewport` из bounds (`bottom: 64px` в CSS), а не перекрывая
    WebContentsView оверлеем — ровно тот путь, что п.8 называл рабочим.
    Персистентная история сайтов (`RecentSitesStore`, `recent-sites.json` в
    userData) следует тому же паттерну fs-хранения, что и `settings.json`/
    `bridge.json`, и тому же принципу изоляции (`BrowserController`/`ElementPicker`
    не знают про fs/IPC — `main/index.ts` подписывается на их колбэки и сам
    решает, что персистить).
13. **Ручной ввод pairing-кода заменён на автообнаружение.** По запросу
    пользователя (нужен UX без ручного шага, как у "DesignAgent"-подобных
    мостов) `BridgeServer` теперь отдаёт токен и через обычный HTTP
    `GET /pairing` на том же порту, что WS (один `http.Server`, WS
    примонтирован через `new WebSocketServer({ server: httpServer })`) — плагин
    сам опрашивает весь диапазон fallback-портов при старте UI и подключается
    без участия пользователя. Подробности и осознанный компромисс по
    security-модели (токен без аутентификации на `/pairing` перестаёт быть
    барьером сам по себе, хендшейк `hello` оставлен ради версии протокола, не
    ради защиты) — см. `docs/bridge-protocol.md` §Discovery.

## 7. Roadmap (вертикальные срезы, из исходного ТЗ, без изменений порядка)

Phase 0 (документация) → Phase 1 (monorepo + Electron shell + Figma Plugin
shell + bridge + темы, **done**) → Phase 2 (встроенный браузер:
`WebContentsView`, адресная строка, back/forward/reload, favicon/title/loading
state — **done**, проверено live через CDP: реальная навигация на google.com
→ example.com, корректные title/favicon/canGoBack) → Phase 3 (element picker:
`Overlay.setInspectMode('searchForNode')` — нативная hover-подсветка и
info-тултип Chromium прямо на странице, `DOM.describeNode`+`DOM.getBoxModel`
по клику → tag/id/classes/размеры в Inspector Panel, Esc отменяет — **done**,
CDP-вызовы (`DOM.enable`/`Overlay.enable`/`Overlay.setInspectMode`/cleanup)
проверены live против реального Chromium через remote-debugging-port; сам
клик по странице — не автоматизирован в этой сессии, стоит визуально
проверить наведение/клик в приложении) → Phase 4 (property extraction:
`CSS.getComputedStyleForNode` по allowlist из conversion-rules.md → Layout/
Typography/Fill/Border/Radius/Shadow в Inspector Panel — **done**, вся цепочка
`DOM.describeNode`/`DOM.getBoxModel`/`DOM.pushNodesByBackendIdsToFrontend`/
`CSS.getComputedStyleForNode` проверена live на реальном `<h1>` example.com —
все нужные computed-свойства присутствуют под ожидаемыми именами) → Phase 5
(Design AST: `packages/conversion-engine` — чистая `convertElement(DomSnapshotNode)`
→ `DesignNode` + diagnostics, без Auto Layout/детей (это Phase 7/8), только
типизация Paint/StrokeInfo/TypographyInfo/CornerRadius/Effect[] из сырых
computed-style строк — **done**, 16 unit-тестов (включая fixture 6: сложный
transform не роняет конвертацию, только diagnostic) + live-проверка: реальные
CDP-данные `<h1>` example.com → `convertElement` → `DesignNodeSchema.safeParse`
успешен)
→ Phase 6 (Figma renderer: desktop получает кнопку "Import as Frame" в
Inspector Panel → `BridgeServer.request()` (новый метод — desktop-инициированные
сообщения с ожиданием ответа, отдельно от request/response самого плагина) →
`ImportNodeMessage` → UI-iframe плагина релеит в main sandbox через
`postMessage` (только там есть `figma.*`) → `renderDesignNode` создаёт
`FrameNode` (fills/strokes/effects/cornerRadius/opacity из DesignNode,
без Auto Layout — Phase 7) → ставится у `figma.viewport.center`, выбирается,
результат уходит обратно как `response`/`error` — **done**. Проверено live:
(1) 23 unit-теста (conversion-engine 16 + новые paint/effects mapping-тесты
figma-plugin 7); (2) отдельный e2e-тест реальными `BridgeServer`+`BridgeClient`
(не переизобретёнными) — сервер шлёт `import-node` с настоящим `DesignDocument`,
клиент отвечает `response`, `server.request()` резолвится корректным
результатом; (3) live против настоящего приложения — ветки "нет выбранного
элемента"/"плагин не подключён" в `inspector:import-as-frame` возвращают
верный `ImportResult`. Не автоматизировано: реальный `figma.createFrame()` —
нужен настоящий Figma, запущенный пользователем; сами CDP-вызовы renderer'а
не задействованы (это Figma Plugin API, не CDP)) → Phase 7 (Flex→Auto Layout:
`display:flex` → `layout.mode`/`gap` (по правильной оси — column-gap для
row, row-gap для column)/`align`/`justify`, с approximation-диагностикой для
`space-around`/`space-evenly` (нет аналога в Figma) в самом conversion-engine,
а Figma-специфичный enum (`MIN`/`MAX`/`CENTER`/`SPACE_BETWEEN`/`BASELINE`,
включая правило "BASELINE только для HORIZONTAL") — в рендерере плагина,
не раньше — **done**. 22 новых unit-теста (8 conversion-engine + 7 renderer +
существующие не сломались) и live-проверка: детерминированная `data:` flex-
страница (не завязана на разметку внешнего сайта, которая может измениться)
→ реальная навигация → реальный `convertElement` → mode/gap/padding/justify/
align совпали с ожидаемыми. По пути поправлен реальный баг в
`normalizeUrlInput`: схемы без `//` (`data:`, `about:`, `file:`, `blob:`) не
распознавались как уже-URL и уезжали поисковым запросом) → Phase 8 (nested
trees: `DOM.describeNode({depth:-1})` даёт всю структуру поддерева одним
запросом (включая `pseudoElements` — оказались полноценно опрашиваемыми через
обычные `DOM.getBoxModel`/`CSS.getComputedStyleForNode` по их
`backendNodeId`, без инъекции `Runtime.evaluate`, что заранее не было
очевидно и было проверено live перед реализацией), затем один batch
`DOM.pushNodesByBackendIdsToFrontend` на все узлы разом и параллельный опрос
box+style — не по одному узлу за раз. `conversion-engine` рекурсивно строит
дерево `DesignNode`; позиционирование ребёнка решается по режиму РОДИТЕЛЯ:
Auto Layout родителя — обычный flow; `position:absolute/fixed` — явные
координаты; родитель без Auto Layout (`mode:'none'`) — тоже явные координаты
как fallback (см. conversion-rules.md §block/inline), с info-диагностикой
`block-layout-approximated`. Материализованные `::before`/`::after` —
обычные дочерние узлы, отфильтрованные, если не имеют визуального эффекта.
Защита от гигантских поддеревьев — cap на 400 узлов с diagnostic
`subtree-truncated` при обрезании. Figma-рендерер рекурсивно `appendChild`,
абсолютные дети получают `layoutPositioning:'ABSOLUTE'` только если у
родителя реально есть Auto Layout (иначе просто x/y на обычном фрейме) —
**done**. 6 новых unit-тестов в conversion-engine (fixture 3 — absolute
badge, fixture 4 — nested flex, fixture 5 — pseudo-element) + живая
проверка: детерминированная `data:`-страница с вложенным flex, absolute
badge внутри flex-родителя и `::before` внутри НЕ-flex кнопки — все 9
структурных проверок прошли на реальном `convertElement`. Осознанно не
входит в этот срез: реальные `<text>`-узлы с содержимым и загрузкой шрифтов
(нужен отдельный проход из-за font-matching/fallback, п.21 ТЗ) — следующий
естественный шаг, не Phase 9) → Phase 9 (asset engine: детекция `<img>`/inline
`<svg>` во время обхода CDP-дерева, реальный HTTP fetch байтов ассетов из
main-процесса, hash-дедуп через `packages/asset-engine`, рендер `type:'image'`
через `figma.createImage`/`type:'vector'` через `figma.createNodeFromSvg` —
**готово**. Новый пакет `packages/asset-engine` (`AssetCollector`,
`fetchAssetBytes`, SHA-256 hash-дедуп с нормализацией SVG-разметки перед
хешированием) — 7 unit-тестов. `conversion-engine` расширен asset-aware типизацией
узлов (image/vector вместо frame при наличии `snapshot.asset`) — 3 новых теста
(33/33 всего). Ключевая находка: `Page.getResourceContent` CDP-метода ненадёжен
для уже загруженных суб-ресурсов (пустой `content` без ошибки для реальных
картинок, при этом исправно работает для главного документа) — решение
пересмотрено в пользу прямого `fetch()` из Electron main-процесса (заодно в
обход CORS/CSP). `figma-plugin/renderers/asset.ts` изолирует работу с
`figma.createImage`/`createNodeFromSvg` от остального рендерера
(`designNode.ts`) — 14/14 существующих тестов плагина не пострадали (asset.ts
не тестируется unit-тестами, т.к. напрямую использует `figma.*`, недоступные
вне реальной Figma). Проверено вживую через `--remote-debugging-port` +
внешний Node/CDP-скрипт на детерминированной `data:`-фикстуре (fixtures 7/8/9:
реальная растровая картинка через `fetch()`, 3 дублированных inline SVG-иконки)
— полный 10/10 PASS: корректная типизация image/vector, корректные
asset-ссылки, корректный hash-дедуп (3 идентичные иконки → 1 ассет, разные
картинки → отдельные ассеты, итого 2 уникальных). Явно отложено: отдельная
панель Asset Inspector (просмотр/copy-to-clipboard ассетов вне единичного
инспектируемого элемента), доставка по требованию для ref-транспорта
(ассеты >256KB), детекция CSS `background-image`) → Phase 10 (Apply to
Selection: перенос выбранных категорий стилей (typography/fill/border/radius/
effects/layout/dimensions) с последнего инспектированного DOM-элемента на уже
выделенные ноды в Figma, без создания новых — **готово**. `ApplyStylesMessage`
существовал в bridge-protocol с Phase 1, реализация появилась только теперь:
`apps/figma-plugin/src/main/renderers/applyStyles.ts` — единственное место,
трогающее `figma.currentPage.selection` для этой операции; multi-selection
поддержан (применяется к каждой выбранной ноде), несовместимость
категория/тип-ноды (напр. `layout` не для TextNode, `typography` не для
Frame) не роняет всю операцию, а копится в `skipped[]` и возвращается вместе
с `appliedTo`. Новые общие хелперы: `cornerRadius.ts` (был приватным в
designNode.ts, вынесен — переиспользуется обеими операциями; принимает
широкий `SceneNode`, а не пытается сузить его на вызывающей стороне, т.к. TS
не резолвит структурное сужение через весь `SceneNode` union из-за нескольких
типов с несовместимой формой поля `cornerRadius`, напр. `ConnectorNode`),
`typography.ts` (font-size/line-height/letter-spacing/align/case/decoration на
`TextNode`; `loadFontAsync` вызывается всегда перед любой мутацией текстовых
свойств, как требует Figma API). Подбор font-family/weight под шрифты,
установленные в Figma (font matching), сознательно не реализован — эвристика
без надёжного способа проверить, что угаданный `{family,style}` существует и
не уронит `loadFontAsync`, это риск уронить всю операцию ради необязательной
части; typography применяется поверх ТЕКУЩЕГО шрифта слоя. `layout.ts`'s
`applyLayout` расширен с чистого `FrameNode` до `FrameNode | ComponentNode |
InstanceNode` — Apply to Selection может целить в Component/Instance, не
только Frame, как раньше умел только рендер новых нод.

Пейринг плагина с desktop заменён с ручного ввода кода на автообнаружение
(см. `docs/bridge-protocol.md` §Discovery) — сделано в этом же срезе по
запросу пользователя, т.к. блокировало практическое использование связки.

Верификация Apply to Selection: unit-тесты не добавлены для `applyStyles.ts`/
`typography.ts`/`cornerRadius.ts` — они (как и `asset.ts` в Phase 9) напрямую
используют `figma.*` глобалы, недоступные вне реальной Figma; типизация
(`tsc --noEmit`) и существующие 14 тестов рендереров (paint/effects/layout)
проходят без изменений. Live-проверка: полный bridge round-trip
(discovery → hello → hello-ack → keepalive ping) подтверждён внешним
mock-клиентом на реально запущенном приложении; IPC-обработчик
`inspector:apply-styles` подтверждён на error-path ("Сначала выберите
элемент" при пустом выделении). Попытка синтетически эмулировать клик через
`Input.dispatchMouseEvent` на второй CDP-сессии для полной проверки
success-пути (нужен реальный pick, чтобы `elementPicker.buildDocument()`
вернул документ) не сработала — как и в Phase 3, реальный click-driven pick
через `Overlay.setInspectMode` не поддаётся надёжной внешней эмуляции; полный
success-путь (реальный pick в Figma + реальный `figma.currentPage.selection`)
не автоматизирован, нужна ручная проверка в самой Figma.

**Реальные текстовые узлы (`type:'text'`) — сделано вне очереди, не Phase 11**
(2026-08-19, тот же день, что Phase 10/pairing/toolbar): после первого
реального импорта пользователь обнаружил, что "Import as Frame" даёт только
пустые вложенные фреймы (`H3`/`P`/`link-accent` как имена слоёв) без самого
текста — conversion-engine никогда не производил `type:'text'` (Design AST
зарезервировал это значение ещё в Phase 1, но продюсера не было). Это было
явно задокументированной, но недооценённой по приоритету дырой — как
выяснилось на практике, критично блокирует реальное использование, поэтому
сделано немедленно, а не по очереди roadmap. Реализация: `apps/desktop/
src/main/domSnapshot.ts` при обходе CDP-дерева определяет "чистый текстовый
лист" (все прямые дети — DOM text-узлы, `nodeType:3`, ни одного вложенного
элемента) и кладёт нормализованный (`white-space:normal`-подобно) текст в
новое поле `DomSnapshotNode.text`; `convertElement` превращает такой узел в
`type:'text'`, используя CSS `color` (не `background-color`) как `fills`
(Figma TextNode = цвет глифов, не фон); `figma-plugin/renderers/textNode.ts`
создаёт `figma.createText()` с подбором начертания под font-weight
(эвристика по именам стилей) и фолбэком на Inter Regular при неудаче
`loadFontAsync` — весь рендер-пайплайн плагина (`designNode.ts`) поэтому стал
асинхронным (`SceneNode`, а не всегда `FrameNode`). Смешанный inline-контент
(`<p>text <b>x</b> text</p>`) намеренно не собирается в один текстовый узел
со стилизованными диапазонами — только вложенный `<b>` конвертируется как
свой узел, потерянный "голый" текст помечается diagnostic
`mixed-inline-text-not-captured`, а не молча теряется. Проверено: 12 новых
unit-тестов в conversion-engine (текстовые листы, смешанный контент,
text-color vs background-color, diagnostic на потерянный inline-текст) +
live-проверка `extractDirectText` на реальных CDP-данных (чистый текст,
смешанный контент, whitespace-only div, вложенный `<b>` внутри `<p>`) — все
5 сценариев совпали с ожиданиями. Не проверено автоматически: сам
`figma.createText()`/`loadFontAsync` вызов — нужна реальная Figma (тот же
класс ограничения, что и raster/vector assets в Phase 9).

Phase 11 (warnings/confidence score, **done**, тот же день): `packages/
conversion-engine/src/confidence.ts` — `computeConfidenceScore(diagnostics)`
(100 минус штраф по severity: info −2, warning −8, error −20, clamp [0,100])
и `confidenceLevel(score)` (high ≥80 / medium ≥50 / low <50). Не научная
формула точности — быстрый сигнал "насколько доверять результату", без
открытия списка диагностик. Desktop UI: блок "Import Quality" в Inspector
Panel — полоска-индикатор + процент, над объединённым списком диагностик
(старый отдельный блок "Diagnostics" слит в этот же). 5 unit-тестов.

Явно отложено по запросу пользователя (для будущей фазы, не сейчас): подбор
СУЩЕСТВУЮЩИХ в Figma-файле text/color styles (а не создание сырых raw-значений
каждый раз) — пользователь предложил анализировать существующие в проекте
стили по параметрам (напр. font-size) и подбирать ближайший, с настройкой
"вставить голым / применить существующий стиль" в UI импорта. Требует
`figma.getLocalTextStylesAsync()`/`getLocalPaintStylesAsync()` + алгоритм
ближайшего соответствия — самостоятельная задача, не часть этого среза.

**"Double border" — найдена и исправлена реальная причина** (тот же день,
после первого реального импорта карточки с сайта пользователем). Не то, что
казалось на первый взгляд: изначальная гипотеза (CSS `transform:translate()`
на `::before`/`::after` не применяется) оказалась НЕВЕРНОЙ — проверено вживую
через CDP: `DOM.getBoxModel` уже отдаёт border-quad С УЧЁТОМ применённого
transform (координаты `::before`/`::after` были смещены ровно на 6px/12px от
родителя, как и должно быть), т.е. позиция УЖЕ корректно захватывалась.
Настоящая причина — `overflow`: сайт использует декоративный приём "стопка
бумаг" (`.paper::before`/`::after` — `position:absolute; inset:0;
transform:translate(6px,6px)/(12px,12px); z-index:-1`, тот же цвет фона/рамки,
что у самого `.paper`), намеренно ВЫХОДЯЩИЙ за границы родителя без
`overflow:hidden` на нём — а наш `figma.createFrame()` НИКОГДА не выставлял
`clipsContent` явно, полагаясь на дефолт Figma API, из-за чего "хвостики"
псевдоэлементов обрезались не так, как в браузере, и на глаз читались как
лишняя тонкая линия рядом с основной рамкой. Исправлено: новое поле
`DesignNode.clipsContent` (`packages/design-ast`), вычисляется в
`convertElement` из `overflow`/`overflow-x`/`overflow-y` (не 'visible' на
любой оси → `true`), `figma-plugin/designNode.ts` теперь всегда выставляет
`frame.clipsContent` явно, а не полагается на дефолт API. Заодно —
`transform-not-applied` diagnostic был ВВОДЯЩИМ В ЗАБЛУЖДЕНИЕ именно для этого
случая (говорил "не применяется", хотя чистый translate на
`position:absolute`-узле УЖЕ эффективно применён через box-модель) — сужен:
подавляется только для чистого `matrix(1,0,0,1,tx,ty)` на absolute-узле,
для rotate/scale/skew и для translate вне absolute-позиционирования
(Auto Layout родителя игнорирует наши x/y) diagnostic остаётся, там смещение
РЕАЛЬНО теряется. 8 новых unit-тестов покрывают оба поведения (включая
regression-проверку, что fixture 6 — non-pure transform — всё ещё варнит).
**Урок**: не чинить первую правдоподобную гипотезу без проверки вживую —
transform был красной селёдкой, реальная причина лежала в соседней, вообще
не обсуждавшейся области (`overflow`/`clipsContent`), которую уже
документировали как "⏳ не реализовано", просто не связывали с этим багом.

**Auto Layout "fill" sizing** (тот же день, ответ на "не подтягивает адаптив
... + не autolayout"). Реализовано `widthSizing`/`heightSizing:'fill'` в
`convertElement.ts`: новый `resolveSizing(layout, style, parentContext)` —
главная ось родителя (`row`→width, `column`→height) заполняется при
`flex-grow > 0`; поперечная ось — при `align-items:stretch` родителя (в т.ч.
CSS-дефолт `normal`, уже корректно маппился в `mapAlignItems` до этой задачи),
если `align-self` самого ребёнка явно не переопределяет. Рекурсия
`convertNode` теперь передаёт вниз `ParentContext{mode, align}` вместо голого
`parentLayoutMode`. На стороне Figma Plugin — `designNode.ts`/
`applyChildSizing()`: `layoutSizingHorizontal`/`Vertical` выставляются
ТОЛЬКО для не-absolute детей реального Auto Layout родителя (`layoutMode !==
'NONE'`) — вне этого условия `'FILL'`/явный `'FIXED'` кидает runtime-ошибку в
Figma API. **"hug" сознательно не реализован** в этом срезе — отличить
"`width:auto`, значит обнять контент" от "ширина явно задана и просто
совпала с контентом" по одному computed-style нельзя, нужен
`CSS.getMatchedStylesForNode` (authored CSS), это отдельная задача. 8 новых
unit-тестов (`fillSizing.test.ts`) + не сломано ни одного из 53 существующих.

**Живая проверка вскрыла отдельную, более фундаментальную причину, почему на
`/standardization` до этой задачи вообще не было Auto Layout** — не баг в
коде конвертера, а следствие того, ПРИ КАКОЙ ширине viewport берётся снапшот.
У сайта кастомный Tailwind-брейкпоинт `layout` = `min-width:900px`, который
переключает `.paper`-карточку с `display:block` на `display:flex;
flex-direction:column`. Встроенный браузер-пейн приложения (реальный размер
`WebContentsView`, он же `DesignDocument.metadata.viewport`) на момент
проверки был 871px шириной — **уже уже брейкпоинта**, поэтому снапшот
честно захватывал мобильную/block-раскладку сайта, а не ту desktop-flex,
которую пользователь видит в своём обычном браузере. Проверено live: то же
дерево, эмулированное через CDP `Emulation.setDeviceMetricsOverride` на
1200px, действительно даёт `display:flex; flex-direction:column;
align-items:normal`, и `resolveSizing` на таком дереве корректно
проставляет `widthSizing:'fill'` детям карточки (h3/p/a растягиваются на
473.5px = внутренняя ширина карточки, ровно как в браузере). **Вывод: fill
sizing реализован и работает корректно, но виден только когда браузер-пейн
приложения достаточно широк для нужного брейкпоинта сайта** — сузить окно
приложения/раздвинуть панели перед импортом адаптивных карточек, либо (если
понадобится) отдельная фича "захват при кастомной ширине viewport" через
`Emulation.setDeviceMetricsOverride` — не реализована, не запрошена в этом
срезе, зафиксирована здесь как готовый следующий шаг.

**Захват независимо от размера browser pane — реализовано следующим же
запросом** ("хочу чтобы при любом размере подхватывалось"), закрывает ровно
тот "готовый следующий шаг" выше. `ElementPicker.withDesktopViewport()`
(`apps/desktop/src/main/inspector.ts`) оборачивает `buildSnapshotTree`: перед
снапшотом читает текущий CDP viewport (`Page.getLayoutMetrics`), и если он
уже `CAPTURE_MIN_WIDTH×CAPTURE_MIN_HEIGHT` (1440×900 — стандартный desktop
reference-размер), временно раздвигает его через
`Emulation.setDeviceMetricsOverride` (`deviceScaleFactor:0` — не трогает DPI,
`mobile:false` — не меняет UA/touch-эмуляцию), даёт странице 100мс на
пересчёт media-query-зависимого CSS, снимает снапшот, снимает override в
`finally`. НИКОГДА не сужает — если реальный pane и так шире 1440px, override
не применяется вообще. `backendNodeId` клика остаётся валиден через relayout
(идентичность DOM-узла не зависит от раскладки). Не автоматизировано в этой
сессии: сам клик-триггер `Overlay.inspectNodeRequested` (та же, давно
известная граница — см. Phase 3) нельзя одновременно драйвить второй внешней
CDP-сессией, пока `wc.debugger` приложения уже подключён к тому же target
(Electron допускает только одного remote-debugging клиента на webContents) —
логика проверена вручную теми же CDP-вызовами, что и в живой диагностике
бага, но полный клик-триггер end-to-end путь остаётся на ручную проверку
пользователем, как и раньше.

**"Стили проекта" (п.21/28 ТЗ) — реализовано** (тот же запрос, "давай делай
поддержку стилей"). Новый `apps/figma-plugin/src/main/renderers/styleMatching.ts`:
`loadStyleCatalog()` грузит `figma.getLocalTextStylesAsync()`/
`getLocalPaintStylesAsync()` ОДИН раз на весь импорт (не на узел), фильтрует
paint styles до однослойных `SOLID` (сравнивать "ближайший" градиент/image
style бессмысленно). `matchNearestTextStyle(fontSize, styles)` — ближайший по
`|fontSize - target|` (единственная ось, которую предложил пользователь: "по
кеглю шрифтов"). `matchNearestSolidPaintStyle(color, styles)` — ближайший по
евклидову расстоянию в RGBA (нет другой разумной метрики для произвольных
цветов). Оба — чистые функции, покрыты unit-тестами (`styleMatching.test.ts`,
6 тестов, не трогают `figma.*`). Применяется как ВТОРОЙ проход поверх уже
установленных raw-значений: `textNode.ts` сначала грузит и применяет
raw-шрифт/цвет как раньше (нужно в любом случае — `figma.createText()`
требует загруженный шрифт до `characters`), и только если каталог передан
(`useMatchedStyles`) — пробует `setTextStyleIdAsync`/`fillStyleId` поверх;
если подходящего стиля нет или `setTextStyleIdAsync` бросает (стиль
ссылается на недоступный шрифт) — тихо остаётся на raw, как и было. Та же
логика для фонов/обводок фреймов в `designNode.ts` (`fillStyleId`/
`strokeStyleId` вместо `fills`/`strokes`, если нашёлся match). Контракт:
`ImportNodeMessage.payload.useMatchedStyles?: boolean` (см.
bridge-protocol.md), настройка `AppSettings.useMatchedStyles`, переключатель
в новом `ImportSettingsPopover` рядом с Import as Frame в floating bar.
Не реализовано намеренно: подбор НАЧЕРТАНИЯ шрифта под installed-в-Figma
шрифты (уже отдельная эвристика в `textNode.ts` до этой задачи, не менялась)
и matching для градиентов/image paint.

**Floating-bar попапы/модалки темы оказались перекрыты нативным browser
view** (тот же день, скриншот пользователя: попап Import Settings обрезан
снизу браузером). Ровно тот сценарий, который класс-docstring
`BrowserController` предсказывал ещё в Phase 2 ("любой будущий UI, которому
нужно визуально перекрыть браузер, должен либо не пересекать эту область,
либо временно прятать view") — просто до этой задачи ни один popover не
залезал в browser area. Первая версия фикса ставила нативному view нулевые
bounds (`BrowserController.setHidden`) на время ЛЮБОГО popover/модалки —
пользователь сразу поймал over-fix: "скрывать то тоже не надо, вот тут
теперь пропадает всё" (скриншот — ImportSettingsPopover открыт, вся страница
под ним чёрная). Исправлено разделением на два разных случая, а не одним
молотком на все:
- **Полноэкранные модалки** (`ThemesGalleryModal`/`ThemeEditorModal` —
  `.modal-backdrop` это `position:fixed; inset:0`, накрывает всё окно с
  затемнением) — здесь full-hide корректен и ожидаем: модалка и так
  блокирует весь остальной UI, скрыть браузер под ней — не сюрприз для
  пользователя. Остался `BrowserController.setHidden(hidden)` (нулевые
  bounds, не трогая `lastBounds` — тот продолжает получать реальную
  геометрию от `ResizeObserver`, на `setHidden(false)` view мгновенно
  возвращается) + IPC `browser:set-hidden` + хук `usePopoverVisibility`
  (модульный счётчик открытых модалок).
- **Мелкие анкорные popover'ы** (`ImportSettingsPopover`/`ApplyToSelectionPopover`
  — `placement="up"`, раскрываются из полосы над браузером) — full-hide для
  них избыточен, они закрывают только небольшую область снизу-по-центру, а
  вся остальная страница должна оставаться видна. `BridgePopover`/
  `SettingsPopover` — вообще не нуждаются в спецобработке (первый в верхнем
  toolbar над browser area, второй `placement="up-stretch"` ограничен
  шириной колонки сайдбара, в browser area не заходит) — usePopoverVisibility
  с них снят. Для двух реально нуждающихся сделан хирургический фикс —
  новый `useBrowserBottomInset(open)` (`apps/desktop/src/renderer/src/hooks/`):
  вместо IPC просто раздвигает CSS-переменную `--browser-bottom-inset`
  (64px → 420px) на `.browser-viewport` — тот же уже существующий механизм
  `BrowserViewport.tsx`'s `ResizeObserver` подхватывает уменьшившийся
  реальный rect и сам шлёт новые (меньшие) bounds через уже работающий
  `browserSetBounds`, без нового IPC вообще. В результате скрывается только
  нижняя полоса под попапом, вся страница выше остаётся видимой и
  интерактивной.
Live-проверено: IPC round-trip `browserSetHidden(true)`→`(false)` не бросает
и не ломает дальнейшие вызовы. Полный визуальный клик-тест — на пользователя,
как и весь click-driven UI в этом проекте; именно так была поймана
регрессия full-hide варианта.

**"Хочу чтобы попап НЕ скрывал браузер, а рисовался поверх" — новый overlay-
слой (`main/overlay.ts`), настоящее решение, не компромисс.** Ни
`setHidden` (round 1), ни `useBrowserBottomInset` (round 2, см. выше) не
устроили пользователя — оба варианта в разной степени всё ещё прячут часть
браузера. `WebContentsView` не умеет частичный z-order средствами CSS/DOM в
принципе — единственный способ показать HTML реально НАД встроенным
браузером, не трогая его bounds вообще, это ВТОРОЙ `WebContentsView`,
добавленный в `win.contentView` ПОСЛЕ browser-пейна (Electron упорядочивает
`addChildView` по времени добавления — поздние дети рисуются выше).
Реализовано:
- `main/overlay.ts` (`OverlayController`) — второй `WebContentsView`,
  прозрачный фон (`setBackgroundColor('#00000000')`, иначе рисует сплошной
  прямоугольник даже там, где реального контента ещё нет — bounds всегда с
  запасом под рост контента), грузит ТОТ ЖЕ renderer-бандл, что и главное
  окно, с `?overlay=1` в URL.
- `renderer/main.tsx` ветвится на этом query-параметре: `?overlay=1` → монтирует
  `OverlayRoot` вместо `App` — ДВА полностью независимых React-дерева/процесса
  в одном приложении, не разделяющих state (у overlay свой `ThemeProvider`,
  темизация read-only, читается из тех же `AppSettings`).
- Единственный shared источник правды — `overlayKind: string | null` в
  main-процессе (`setOverlay()` в `index.ts`), транслируется ОБОИМ рендерерам
  разом через `overlay:content` — главное окно выводит из него `open` для
  своей иконки-якоря (никакого локального `open`-state, который может
  рассинхронизироваться), overlay-рендерер — какой контент показывать.
  Закрытие может прийти откуда угодно (Escape в overlay, клик снаружи в
  главном окне, клик В САМУ СТРАНИЦУ браузера — через новый `onFocus`
  колбэк `BrowserController`, реальный клик в webContents переводит на него
  OS-фокус, что наблюдаемо через `wc.on('focus')`; resize/move окна — bounds
  посчитаны от старой позиции якоря, закрываем вместо неправильного
  положения) — и всегда синхронно закрывает оба рендерера через тот же канал.
- Позиция/размер попапа — фиксированный `WIDTH×HEIGHT` (300×460), координаты
  считает САМ renderer главного окна в момент открытия (`getBoundingClientRect()`
  якоря − та же система координат, что уже использует `browserSetBounds`, см.
  `BrowserViewport.tsx` — окно, не экран, никакой конвертации не нужно),
  просто передаются в `overlay:open` как готовый прямоугольник.
- **Apply to Selection переведён на эту схему первым** (`ApplyToSelectionPopover.tsx`
  теперь только иконка-якорь + расчёт координат; тело попапа вынесено в
  `ApplyToSelectionContent.tsx`, самодостаточный — свой `onInspectorSelection`,
  свой `inspectorApplyStyles`, без пропсов от главного окна, т.к. это другой
  процесс). `useBrowserBottomInset` (round 2) стал мёртвым кодом после этого
  и удалён вместе с CSS-переменной — единственный пользователь ушёл на
  overlay. `usePopoverVisibility`/`setHidden` (round 1) остаются ТОЛЬКО для
  полноэкранных модалок тем, где full-hide by design корректен (см. выше).
- Live-проверено через CDP на двух РАЗНЫХ page targets одновременно (главное
  окно + overlay): `overlayOpen()` из главного окна → overlay реально
  получает и рендерит контент (`document.body.innerText` содержит "Apply to
  Selection"), фон overlay действительно прозрачный
  (`getComputedStyle(body).backgroundColor === 'rgba(0,0,0,0)'`),
  `overlayClose()` корректно очищает контент. Не автоматизировано: реальный
  клик по иконке (та же граница, что и весь click-driven UI здесь) и
  визуальная проверка, что попап действительно рисуется НАД видимой
  страницей браузера, а не просто существует в DOM.

**"Стили проекта" разделены на два независимых переключателя и вынесены из
попапа в правую панель** (тот же запрос). `AppSettings.useMatchedStyles`
(один булев) → `useMatchedTextStyles`/`useMatchedColorStyles` (два, независимо
управляемых) — пользователь может матчить, например, только цвета, не трогая
шрифты. `ImportNodeMessage.payload` и весь путь до `figma-plugin` (`code.ts`,
`renderDesignNode`, `createTextNode`, `designNode.ts`) обновлены на два флага;
новый `StyleMatchOptions` в `styleMatching.ts` — `{catalog, matchText,
matchColor}`, каталог грузится один раз, если включён хотя бы один флаг,
дальше каждый узел проверяет СВОЙ флаг перед попыткой матчинга конкретно для
текста/цвета. `ImportSettingsPopover.tsx` (жил в floating bar) удалён —
контент (2 `Switch`) переехал в `InspectorPanel.tsx` как всегда видимый Block
"Стили проекта при импорте" (не под `showDetails` — это глобальная настройка
импорта, не свойство текущего выбора), читает/пишет `AppSettings` напрямую.

→ далее расширение scope.

**Четыре независимых бага/фичи одним запросом пользователя** (тот же день):

1. **Правая панель не подхватывала уже сделанный выбор, если была закрыта в
   момент клика пикером.** `InspectorPanel.tsx` держал `selection` только в
   локальном React state, который живёт, только пока панель смонтирована
   (`{rightOpen && <InspectorPanel/>}` в `Workspace`) — закрыл панель → выбрал
   элемент → открыл панель → пусто, пока не кликнешь заново. Исправлено:
   `ElementPicker` теперь хранит `lastSelectionResult` (не только
   `lastConversion`, тот был для другого — построения `DesignDocument`),
   новый IPC `inspector:get-last-selection` — панель на каждом монтировании
   сама подтягивает актуальный выбор, а не ждёт только live-событие.

2. **"Дёрг" страницы на каждый клик в inspect-режиме.** Прямое следствие
   viewport-independent capture (см. запись выше того же дня) —
   `withDesktopViewport` реально РАЗДВИГАЛО видимый CDP-viewport на каждом
   клике пикера, страница на глазах пересчитывала раскладку и тут же
   схлопывалась обратно. Исправлено переносом override'а с "каждый клик" на
   "один раз перед реальным импортом": `handleInspectNodeRequested` снимает
   снапшот на ТЕКУЩЕМ (реальном) viewport без каких-либо побочных визуальных
   эффектов — как было до фичи; новый `ElementPicker.prepareForImport()`
   (вызывается из `inspector:import-as-frame` ПЕРЕД `buildDocument()`)
   пересобирает `lastConversion` на desktop-ширине для уже выбранного
   `lastBackendNodeId`, временно переподключая CDP debugger (тот уже
   отсоединён к этому моменту — `stop()` вызывается сразу после каждого
   клика). "Дёрг" остаётся, но один раз на committing-действие Import as
   Frame, а не на каждый exploratory-клик — общий код капчура вынесен в
   `captureAndConvert()`, общий и для обычного клика, и для этого прохода.

3. **"Recent" считал разные страницы одного домена разными сайтами.**
   `RecentSitesStore.recordVisit()` дедуплицировал по точному URL, хотя UI
   (`LeftSidebar.tsx`) уже показывает hostname как подпись — один сайт
   = одна запись. Новый `siteKey(url)` = `new URL(url).hostname` (fallback на
   сам url при ошибке парсинга — деградация к прежнему поведению, не падение);
   переход на другую страницу того же домена теперь ОБНОВЛЯЕТ существующую
   запись (новый url/время), а не плодит вторую. Плюс одноразовая миграция в
   `load()` — схлопывает уже накопленные до фикса дубли одного домена в уже
   сохранённом `recent-sites.json` (most-recent-first — первое вхождение
   ключа и есть самая свежая запись).

4. **Вкладки браузера** ("усилить браузер, работать с несколькими сайтами
   сразу") — `BrowserController` (`main/browser.ts`) переписан с одного
   `WebContentsView` на карту вкладок (`Map<string, {id, view, state}>`),
   видна только АКТИВНАЯ (у остальных нулевые bounds — тот же приём, что и
   `setHidden`, реального скрытия WebContents в Electron нет). Каждая вкладка
   сохраняет РЕАЛЬНОЕ состояние страницы (scroll/JS/форма) при переключении —
   не просто URL, полноценные вкладки, а не история навигации в одном view.
   `newTab()`/`closeTab()`/`switchTab()` — закрытие активной вкладки
   переключает на соседнюю (или создаёт новую стартовую, если закрыли
   последнюю); IPC `browser:new-tab`/`close-tab`/`switch-tab`/`get-tabs` +
   broadcast `browser:tabs` (`TabsSnapshot{tabs, activeTabId}`) заменили
   старые `browser:get-state`/`browser:state` (были заточены под ровно одну
   вкладку). Новый `BrowserTabBar.tsx` — полоса вкладок над `BrowserToolbar`
   (favicon/заголовок/крестик закрытия/кнопка "+"), `BrowserToolbar`
   не изменился структурно — просто теперь получает state АКТИВНОЙ вкладки
   вместо единственного on `browserGetState`. Пикер сбрасывается
   (`elementPicker?.stopIfActive()`) на переключении/закрытии вкладки, не
   только на навигации — CDP debugger-сессия привязана к конкретному
   webContents конкретной вкладки, переключение делает её невидимой/неактуальной.
   Live-проверено через CDP: создание/переключение/закрытие вкладок,
   `activeTabId` корректно отслеживается. Живая проверка domain-дедупа
   recent sites (см. п.3) не завершена в этой сессии — сеть в момент
   тестирования была нестабильна (таймауты даже для ранее рабочих доменов,
   включая ris.pxls-cdn.ru) — логика проверена только код-ревью (чистая
   функция `siteKey`, простая и легко проверяемая на глаз), не live-тестом;
   стоит перепроверить вживую при следующей возможности.

**"После клика в инспект-режиме у элемента пропадает выделение"** (следующий
день). Причина: `Overlay.setInspectMode`'s hover-подсветка — CDP-нарисованный
оверлей, который живёт ровно до тех пор, пока debugger-сессия жива;
`stop()` (вызывается сразу после каждого клика, "клик фиксирует выбор") и
`Overlay.setInspectMode('none')`, и затем `dbg.detach()` — оба гарантированно
убирают подсветку, отсоединение debugger'а само по себе тоже стирает любые
CDP-оверлеи, так что убрать вызов `setInspectMode('none')` ничего бы не
исправило. Раз CDP-оверлей принципиально не переживает detach — подсветка
выбранного элемента сделана НЕ через `Overlay`, а простым инлайн-`outline`
на самой странице (переживает detach, это обычный DOM/CSS): `DOM.resolveNode`
→ `Runtime.callFunctionOn` с функцией, которая ставит `element.style.outline`
и запоминает прежнее инлайн-значение в атрибуте-маркере `data-w2f-picked`
(JSON, не held object reference — тот тоже не переживает detach/повторный
attach между отдельными кликами). Снимается не по held-ссылке, а по
querySelectorAll(`[data-w2f-picked]`) — в начале КАЖДОГО нового `start()`
(новый pick начинается "с чистого листа", предыдущая подсветка убирается).
Live-проверено через CDP на реальной странице (`ris.pxls-cdn.ru`): apply
корректно ставит `outline`/`outlineOffset` и сохраняет прежние (пустые)
значения в атрибуте, clear корректно восстанавливает и удаляет атрибут.

**Два реальных бага в overlay-слое (см. выше), пойманы пользователем на
скриншоте: попап открывался "непонятно где", и Apply писал "сначала
выберите элемент" при уже выбранном.**

1. **Позиция.** Первая версия `ApplyToSelectionPopover` считала `y` окна
   overlay'я из ФИКСИРОВАННОЙ высоты-константы (`HEIGHT = 460`), а CSS
   попапа (`.overlay-popover`) был `position:static` — т.е. прижимался к
   ВЕРХУ overlay-окна, а не к низу. Итог: реальный контент (часто короче
   460px) оказывался у ВЕРХА окна, а низ окна (где реально нужен попап,
   у якоря) оставался пустым — попап визуально "улетал" далеко от иконки.
   Исправлено правильно, не подгонкой константы: overlay теперь сам
   измеряет свой реальный рендер (`ResizeObserver` на обёртку в
   `OverlayRoot.tsx`) и шлёт высоту через новый `overlay:report-size`; main
   (`applyOverlayBounds()` в index.ts) пересчитывает `y = anchorTop − GAP −
   height` на КАЖДОЕ обновление высоты — нижний край попапа математически
   всегда у якоря, независимо от реальной высоты контента. Начальная оценка
   (420px, ставится сразу при `overlay:open`, до первого измерения) тоже
   идёт через ту же формулу, поэтому даже она уже позиционирована правильно
   по нижнему краю — просто верх невидимого (прозрачный фон) bounds-
   прямоугольника на один кадр может быть чуть выше/ниже настоящего. CSS
   `.overlay-root` получил `display:flex; flex-direction:column;
   justify-content:flex-end` — сам контент внутри тоже прижат к низу.
   `OverlayOpenPayload` изменился: вместо `{x,y,width,height}` теперь
   `{kind,x,width,anchorTop}` (высота больше не часть контракта открытия,
   только `overlay:report-size` её поставляет). Live-проверено через CDP на
   реальном якоре (иконка wand в floating bar): overlay действительно
   сжался с начальной оценки 420px до настоящих ~65px контента, нижний край
   попапа (`cardRect.bottom`) точно совпал с `window.innerHeight`.

2. **"Сначала выберите элемент" при уже выбранном.** `ApplyToSelectionContent`
   живёт в overlay-рендерере (отдельный `webContents`, не главное окно) и
   подписан на `onInspectorSelection`, но `elementPicker`'s callback в
   index.ts слал `inspector:selection` ТОЛЬКО в `mainWindow.webContents` —
   overlay никогда не получал это событие вообще, поэтому `hasSelection`
   там навсегда оставался `false`, даже когда элемент реально был выбран и
   виден в правой панели главного окна. Исправлено — тот же callback теперь
   шлёт и в `mainWindow.webContents`, и через `overlayController.send(...)`
   (тот же метод, что уже используется для `overlay:content`) — оба
   рендерера получают событие синхронно.

**Тот же баг-класс всплыл ещё раз, тем же вечером** — dual-broadcast (п.2
выше) не полностью решил проблему, пользователь скриншотом показал: элемент
реально выбран (виден в правой панели), но Apply to Selection по-прежнему
"Сначала выберите элемент". Причина другая: `ApplyToSelectionContent`
монтируется ЗАНОВО при каждом открытии попапа (условный рендер в
`OverlayRoot.tsx`), а обычный порядок действий — сначала выбрать элемент,
ПОТОМ открыть Apply to Selection — значит live-событие `inspector:selection`
уже произошло и было пропущено ДО того, как компонент вообще существовал (не
проблема доставки, тот самый класс бага, что уже чинили в `InspectorPanel.tsx`
раньше в тот же день — компонент, монтируемый условно, не может полагаться
только на live-событие). Исправлено тем же приёмом: на mount дополнительно
вызывает `window.api.inspectorGetLastSelection()` (тот самый IPC, уже
существовавший для `InspectorPanel`) и подхватывает уже сделанный выбор
явным запросом. Live-проверено через CDP: `inspectorGetLastSelection()` из
overlay-рендерера корректно вернул выбранный `div`, после открытия попапа
показывает полную форму (все 7 переключателей + кнопка Apply), а не
"выберите элемент". **Урок про два независимых рендерера в этом приложении**:
любой компонент, который может монтироваться ПОСЛЕ того, как относящееся к
нему событие уже произошло (не только "другой процесс", но и "просто
смонтирован позже своего же процесса"), нуждается в hydrate-запросе на
mount, а не только в live-подписке — недостаточно один раз почитать
"обе стороны получают broadcast", нужно ЕЩЁ проверить, что получатель уже
существует в момент отправки.

**Apply to Selection протестирован пользователем "вживую" — реально работает,
но всплыли два содержательных запроса по "стилям проекта".**

1. **Text style matching стал weight-aware, не только по кеглю.**
   Пользователь поймал реальный кейс: карточка с заголовком+телом — ближайший
   ПО РАЗМЕРУ text style мог оказаться совсем другого начертания (напр. жирный
   заголовок попадал на style с обычным весом просто потому что тот ближе по
   кеглю) — "не воспринимает веса моих стилей". `matchNearestTextStyle`
   (`styleMatching.ts`) теперь принимает `weight` и делает его ДОМИНИРУЮЩИМ
   критерием: большой штраф (10000) любому style, чьё `fontName.style` не
   содержит ожидаемое имя начертания (та же эвристика `weightToStyle`, что уже
   была в `textNode.ts` для подбора РЕАЛЬНОГО шрифта с нуля — перенесена в
   `styleMatching.ts` и переиспользуется в обоих местах, дублирования больше
   нет). fontSize остаётся tie-breaker'ом СРЕДИ кандидатов одного начертания;
   если ни один style не совпадает по весу вообще — честно откатывается на
   ближайший по размеру (лучше приблизительный style, чем raw-провал). Матчинг
   имени начертания — case-insensitive substring (`"bold italic".includes("bold")`
   тоже засчитывается).

2. **Цвет теперь можно матчить на Figma Variable, не только на Paint Style** —
   пользователь явно попросил выбор, не одно зашитое поведение. Новое
   `ColorMatchSource = 'style' | 'variable'` в `styleMatching.ts`:
   `loadColorVariables()` грузит `figma.variables.getLocalVariablesAsync('COLOR')`,
   резолвит каждую на `defaultModeId` её коллекции (без привязки к конкретному
   consumer-узлу заранее неизвестно, какой режим у будущего узла — алиасы
   пропущены целиком, разрешение цепочки алиасов не нужно для подбора
   "ближайшего"). Новая единая точка входа `matchColor(color, catalog, source)`
   скрывает разницу в API между "Paint Style" (`fillStyleId`, готовый Figma-
   концепт) и "Variable" (нужно сначала собрать raw `SolidPaint`, затем
   `figma.variables.setBoundVariableForPaint(paint, 'color', variable)`,
   которая возвращает НОВЫЙ paint с привязкой) — `designNode.ts`/`textNode.ts`
   просто применяют результат (`fillStyleId=` или `fills=[paint]`), не зная
   деталей источника. Настройка `AppSettings.colorMatchSource` + новый
   `Segmented` (Style/Variable) в блоке "Стили проекта при импорте"
   `InspectorPanel.tsx` — показывается только когда переключатель "Цвета"
   включён. Контракт `ImportNodeMessage.payload.colorMatchSource?` (optional,
   дефолт `'style'` для обратной совместимости) протянут через весь путь:
   bridge-protocol → code.ts → App.tsx (UI relay) → `renderDesignNode`.
   Live-проверено: переключение Style→Variable в правой панели корректно
   сохраняется в `AppSettings` и передаётся в правильном месте пайплайна
   (сам подбор переменной — юнит-тестами `styleMatching.test.ts`, включая
   мок `figma.variables.setBoundVariableForPaint`, т.к. реальный биндинг
   переменной можно проверить только в настоящей Figma).

**"Выбрал Variable, а всё равно применяется как style" — прошёл всю цепочку
живьём, бага в проводке не нашёл, добавлена диагностика вместо очередной
догадки.** Проверено по всей цепочке до байта: `AppSettings.colorMatchSource`
корректно сохраняется/читается (живая проверка через CDP), `PickerFloatBar`
корректно шлёт его 3-м аргументом в `inspectorImportAsFrame`, IPC/preload/
`createMessage` — позиционные аргументы совпадают, **собранный
`dist/ui.html` реально содержит `colorMatchSource: we(["style","variable"]).optional()`**
в скомпилированной Zod-схеме (проверено grep'ом по файлу — не теория, факт),
`App.tsx`'s relay корректно прокидывает `y.payload.colorMatchSource` в
`postToMain`. Ни одного места, где `matchColor()` мог бы вернуть
`{kind:'style'}`, когда `colorMatchSource==='variable'`, в коде НЕТ — код
либо матчит на variable, либо (если кандидатов нет) откатывается на RAW
(plain fill), но НИКОГДА не на style, если source стоит на 'variable'.

Раз баг в проводке не подтверждается, а живого доступа к файлу пользователя
нет (нет Figma MCP в этой сессии) — добавлена диагностика вместо гадания
дальше: `warnIfCatalogEmpty()` в `designNode.ts` — если "стили проекта"
включены, а подходящих кандидатов (text styles / paint styles / color
variables, в зависимости от `colorMatchSource`) в файле нет вообще —
`figma.notify()` (тост прямо в Figma, не нужно лезть в консоль плагина).
Заодно `loadColorVariables()` обёрнут в `.catch()` — Variables API теоретически
может бросить (напр. недоступна на текущем плане файла), раньше это уронило
бы весь импорт молча необъяснимой ошибкой, теперь откатывается на пустой
список + тот же тост через `warnIfCatalogEmpty`. Следующий шаг зависит от
того, что покажет тост при реальном импорте — если "Color variables не
найдены" — значит в файле пользователя их действительно нет (это не баг,
а факт о файле); если тоста нет вообще — значит кандидаты находятся, и
разбираться нужно уже в самом подборе/применении, не в проводке.

→ далее расширение scope.

**2026-08-19/20 — Панель ассетов: отдельный обзор иконок/картинок всей
страницы, независимый от Inspector-выбора.** Пользователь запросил разом
четыре крупные фичи (панель ассетов, полный auto layout/grid, смешанный
текст, компоненты) — решено делать по одной, полноценно, начиная с панели
ассетов как самой самодостаточной.

Новый `main/assetScanner.ts`: `scanPageAssets(wc)` сканирует ВСЮ страницу
через `DOM.getDocument({depth:-1, pierce:false})` (не поддерево одного
выбранного элемента, как `buildSnapshotTree` в `domSnapshot.ts`) — собирает
inline `<svg>` (через `DOM.getOuterHTML`) и `<img src>` (через
`fetchAssetBytes`, переиспользуя `asset-engine`), классифицирует
"иконка vs картинка" по формату (SVG → icon, растр → image — простой
предсказуемый дефолт, не идеальный, но с меньшим числом ложных срабатываний
на реальных сайтах, чем эвристика по размеру). Дедуп по `hashContent` (тот
же SHA-256 хелпер из `asset-engine`, но БЕЗ обёртки `AssetCollector` — её
256KB inline/ref-лимит заточен под транспорт `DesignDocument` по bridge, а
превью в панели живут целиком в памяти desktop-процесса до явного клика
"отправить", лимит там не нужен). Ограничения — `MAX_ASSETS=300` (просто
листинг, не полноценный импорт дерева) и `MAX_ASSET_BYTES=8MB` на один
ассет (не даёт гигантскому hero-баннеру раздуть IPC-сообщение).

**Баг, пойманный собственной живой проверкой ДО показа пользователю:**
первая версия `scanPageAssets` звала `dbg.sendCommand(...)` не подключив
CDP-сессию — `"No target available"`. Уже установленный паттерн
`ElementPicker.prepareForImport()` в `inspector.ts` (attach-if-not-already,
detach-in-finally только если подключали сами) не был повторён при
написании нового файла. Исправлено переносом той же attach/detach-логики
в обёртку `scanPageAssets()` вокруг внутреннего `scanWithAttachedDebugger()`.
**Урок на будущее: любая НОВАЯ функция в main-процессе, которая напрямую
зовёт `dbg.sendCommand`, должна повторить этот attach/detach-паттерн — это
не разовая случайность, а забытый шаг, который легко повторить снова.**

Новое самодостаточное bridge-сообщение `PlaceAssetMessage`
(`bridge-protocol/src/messages.ts`) — везёт `data:` URL прямо в payload,
НЕ ссылается на `DesignDocument.assets` (в отличие от уже существующих, но
всё ещё не реализованных `ImportAssetMessage`/`ImportAssetsMessage`,
рассчитанных на ref-транспорт внутри полного импорта дерева) — отправка
одного ассета в Figma не привязана к текущему выбору/дереву.

Figma-плагин: новый `createAssetNode()` в `renderers/asset.ts` — SVG через
`figma.createNodeFromSvg`, растр через `figma.createImage` + `Rectangle` с
`IMAGE`-fill'ом. **Второй баг, тоже пойманный живой проверкой (реальный
Figma-сеанс был подключён во время тестирования):** `new TextDecoder('utf-8')`
не существует в песочнице Figma-плагина (это не браузерная страница, а
урезанная JS-среда) — `sendResult` возвращал `"'TextDecoder' is not defined"`
при попытке отправить SVG-иконку. Исправлено вручным UTF-8-декодером байтов
(`utf8Decode()`) вместо `TextDecoder` — та же причина, по которой уже
существующий `base64ToUint8Array` в этом файле использует голый `atob`,
а не браузерные Encoding API. **Урок: песочница Figma-плагина — не React UI
(`App.tsx`, там браузерные API есть) и не desktop main-процесс (там Node) —
это третья, самая урезанная среда; любой новый код в `main/` (не `ui/`)
figma-plugin, использующий Web API за пределами Plugin API, нужно
живьём проверять именно там, а не полагаться на то, что раз typecheck
прошёл — значит и в рантайме сработает.**

UI: `AssetsPanel.tsx` в левом сайдбаре, переключается через `Segmented`
("Недавние"/"Ассеты" — тот же generic-примитив из `@web-to-figma/ui`, что
уже используется для Light/Dark/System и Style/Variable). Ручной запуск
скана (кнопка "Сканировать страницу", не авто на каждой навигации) —
предсказуемее и дешевле. Два раздела-сетки (иконки/картинки), на каждом
тайле — hover-иконки Copy (в буфер: SVG как текст через `clipboard.writeText`,
растр как изображение через `clipboard.writeImage`+`nativeImage.createFromDataURL`)
и Send (через bridge, если плагин не подключён — явная ошибка на тайле, не
тихий провал).

Всё — скан, копирование, отправка в Figma — live-проверено через CDP-скрипты
против реальной страницы (`ris.pxls-cdn.ru/standardization`, 26 SVG-иконок)
и реального подключённого Figma-сеанса (send-to-Figma подтверждённо создаёт
узел без ошибок после фикса TextDecoder). Полный `pnpm -r typecheck/build/test`
проходит без регрессий.

→ далее feature #2 из списка пользователя: auto layout/grid.

**2026-08-20 — Панель ассетов переехала из левого сайдбара в нижнюю
закреплённую панель центральной области, плюс пять содержательных фиксов по
живому отзыву пользователя.** Первая версия панели (см. выше) жила вкладкой
в `LeftSidebar` — пользователь явно попросил переезд: открывается снизу
центральной рабочей области, верхний край тянется мышью, в шапке кнопка
"на весь экран". Новый `BottomPanel.tsx` (в `BrowserPane.tsx`, после
`.browser-viewport-wrap`) — collapsed/expanded/maximized как отдельные
состояния, вертикальный ресайзер (свой pointer-capture хэндлер по Y, не
переиспользует `useResizer` из `@web-to-figma/ui` — тот заточен под
`deltaX`, а нужен ровно один вызывающий, обобщать смысла нет), высота
клэмпится между `MIN_HEIGHT=140` и `containerHeight - MIN_BROWSER_RESERVE`
(измеряется у родителя `panelRef.current.parentElement` — это и есть
`.center-col`, т.к. `BrowserPane` рендерит фрагмент без своего DOM-узла).

**Maximized-режим — `maximized` поднят в `BrowserPane`, не остался локальным
состоянием `BottomPanel`**, потому что схлопывание вьюпорта браузера до
0 требовало ОДНОЗНАЧНЫХ flex-значений на обеих сторонах одновременно: если
`.browser-viewport-wrap` и `.bottom-panel.maximized` одновременно получают
`flex:1 1 auto`, авто-basis у обёртки без in-flow контента (сам
`BrowserViewport`/`PickerFloatBar` — `position:absolute`) даёт неоднозначное
деление места между двумя элементами. Решение — явные `flex:'0 0 0px'` на
обёртке и `flex:'1 1 auto'` на панели, выставляются из ОДНОГО общего родителя
(`BrowserPane`), а не пытаются разрулиться через CSS-каскад. Схлопнутая до
`0×0` `.browser-viewport-wrap` естественно приводит к нулевым
`browserSetBounds()` через уже существующий `ResizeObserver` в
`BrowserViewport.tsx` — тот же механизм, что `BrowserController.setHidden()`,
без единой новой строчки в main-процессе.

Персистентность (запрос пользователя — "если перейти на другую панель, то
просканированные ассеты слетают") решена архитектурно: результаты сканов
(`Record<tabId, TabAssetScan>`) переехали из `AssetsPanel.tsx` в
`BrowserPane.tsx` — компонент, который никогда не размонтируется, в отличие
от `AssetsPanel`/будущей "Компоненты" вкладки внутри `BottomPanel`, которые
рендерятся условно по `panelTab`. Каждый `TabAssetScan` фиксирует заголовок
вкладки НА МОМЕНТ скана (не лайв), удаляется автоматически, когда
соответствующая вкладка браузера закрывается (`useEffect` по `tabs`).
Агрегация по нескольким страницам (тоже запрос пользователя) — тривиальное
следствие той же модели: кнопка скана всегда сканирует ТЕКУЩУЮ активную
вкладку (без изменений в `assetsScan()`/main-процессе), результат кладётся
под её `tabId`; UI просто рендерит по группе на каждый `tabId`, у которого
есть скан, в порядке вкладок браузера.

**Три независимых бага нашлись при живой проверке ПОСЛЕ переезда панели —
превьюшки не отображались вообще, хотя скан находил реальные ассеты:**

1. **CSP `index.html`** (`default-src 'self'`, без `img-src`) тихо блокировал
   ЛЮБОЙ `<img src>` не с `'self'`-origin — не только новые `data:`-превью
   ассетов, но и (как попутная находка) уже существовавшие фавиконки
   "Недавних" (`s.faviconUrl`, реальные `https://` адреса из
   `page-favicon-updated`) — они, судя по всему, никогда не рендерились с
   момента появления фичи. Добавлен `img-src 'self' data: https: http:`.
2. **`CSS.getComputedStyleForNode` молча ничего не возвращал** в
   `assetScanner.ts` — забыт `DOM.enable`/`CSS.enable` перед вызовом (тот же
   шаг, что `ElementPicker.start()` в `inspector.ts` делает явно) — без него
   инъекция реального цвета для `currentColor`-иконок просто не срабатывала,
   `.catch(() => null)` глотал ошибку молча.
3. **`DOM.getOuterHTML` не сериализует `xmlns` на инлайновом `<svg>`** — в
   HTML-документе namespace выводится неявно по правилам HTML5-парсера,
   отдельный `data:image/svg+xml` документ так не умеет: без явного
   `xmlns="http://www.w3.org/2000/svg"` Chromium не может декодировать
   получившийся `data:` URL как картинку — тихо (`img.complete=true`,
   `naturalWidth=0`, никакой ошибки в консоли). Пойман только сравнением
   `naturalWidth` РЕАЛЬНО отрисованных `<img>` из живого DOM с их markup'ом
   в одном проходе — два раздельных вызова `assetsScan()` для сравнения
   индексов оказались ложным следом: `Promise.all` над узлами SVG резолвится
   в непредсказуемом порядke, так что позиции в двух разных сканах не
   соответствуют друг другу.

Оба SVG-фикса объединены в один `prepareSvgMarkup()` (было
`injectCurrentColor()`) — правится один открывающий тег `<svg …>` за один
проход вместо двух последовательных regex-подстановок.

**Ещё один структурный баг, найденный СРАЗУ после первой живой проверки
багфиксов, по свежему отзыву пользователя** ("блок сильно растягивается и
сплющивает остальные окна... нет переноса контейнеров на разной ширине"):
`.center-col` использовал `flex: 1 1 auto` — при auto flex-basis размер
колонки на этапе "сколько места запросить" считается по СОДЕРЖИМОМУ, и когда
сетка тайлов ассетов внезапно захотела ~1150px вместо пустого прежнего
состояния, этот раздутый basis участвовал в общем shrink-распределении
наравне с левой/правой панелью (у `.col` shrink:1 по умолчанию, никто не
защищал их явно) — обе сплющивались пропорционально вместо того, чтобы
просто центральная колонка забрала себе доступный остаток. Пофикшено
идиоматично: `flex: 1 1 0%` вместо `auto` — теперь размер колонки считается
ИСКЛЮЧИТЕЛЬНО из доступного места (она единственная с `flex-grow>0` в
`.workspace`), содержимое больше не участвует в базовом расчёте вообще.
Отдельно (независимо от этого) добавлен `min-width:0` по всей цепочке
`.bottom-panel` → `.bottom-panel-body` → `.assets-panel` →
`.assets-page-group`/`.assets-section` → `.assets-grid` — та же самая ловушка
на уровень ниже (CSS Grid с `auto-fill` внутри flex-колонки), нужна ОБА
фикса одновременно: `flex-basis:0` не даёт контейнеру раздуться САМОМУ, а
`min-width:0` по цепочке даёт содержимому реально перенестись по строкам,
а не растянуться в одну широкую строку внутри уже верно посчитанного
контейнера.

**Остальные три пункта отзыва — целенаправленные UX-правки, не баги:**
кнопка скана переехала из тела панели в шапку (`IconButton` с `RefreshCw`,
рядом с maximize/collapse); сетка иконок — `minmax(40px,…)` →
`minmax(64px,…)` (на 40px две 22px-кнопки copy/send при наведении банально
не помещались рядом); свёрнутая полоса заголовка целиком кликабельна для
разворачивания (`.bottom-panel-header.collapsed`, `stopPropagation` на всех
кнопках внутри, чтобы клик по ним не дублировал разворачивание через
всплытие); клик по тайлу открывает `AssetLightbox.tsx` — полноэкранный
просмотр с зумом (колесо мыши + кнопки ±25%, `scale()` поверх
`object-fit:contain`), переиспользует `.modal-backdrop`/`usePopoverVisibility`
(тот же паттерн, что `ThemesGalleryModal` — полноэкранная модалка ожидаемо
прячет нативный `WebContentsView` браузера, это не тот случай "мелкого
попапа", который пользователь дважды отклонял раньше в этой же сессии).

**Тут же, следующим сообщением: "в полноэкранке не работает драг, должен по
средней кнопке мыши и по левой работать".** Первая версия панорамирования
двигала `scrollLeft`/`scrollTop` контейнера с `overflow:auto` — логичный
путь, раз картинка и так центрируется через `justify-content:center`/
`align-items:center`. Живая проверка вскрыла реальный CSS-баг: у Chromium
`scrollWidth`/`clientWidth` контейнера остаются РАВНЫ друг другу даже когда
`transform:scale()` на центрированном flex-child'е визуально выходит далеко
за его границы — `overflow:auto` в этой комбинации попросту не считает
трансформированное переполнение скроллируемым (задокументированная
особенность вычисления overflow для центрированных через
align/justify-content элементов, не баг конкретно этого кода). Переписано на
ручной `translate(panX, panY) scale(zoom)` прямо в `transform` картинки —
`pan: {x,y}` в состоянии компонента, обновляется по дельте от точки
`pointerdown` (тот же паттерн pointer-capture, что резайзер `BottomPanel`).
`.lightbox-viewport` сменил `overflow:auto` на `hidden` (скролл больше не
средство панорамирования, только визуальное обрезание). Кнопка/событие
"Сбросить масштаб" сбрасывает и `zoom`, и `pan` одновременно — иначе после
сброса масштаба картинка осталась бы отпанорамленной в сторону.
`onPointerDown` проверяет `e.button === 0 || e.button === 1` (левая ИЛИ
средняя, как попросил пользователь) — колесо мыши (`onWheel`) осталось
отдельным путём для зума, не конфликтует с панорамированием, т.к. это разные
события. Live-проверено через синтетические `PointerEvent`
down/move/up обеими кнопками — `transform` в DOM корректно накапливает
смещение по каждому драгу, сброс возвращает `translate(0px,0px) scale(1)`.

**Тут же, ещё одно сообщение: "ассеты не аккумулируются если переходить по
разным страницам одного домена, пусть аккумулируются, а повторяющиеся не
показываются" + следом "пусть показывается с какой страницы уникальные
отдельной подписью".** Скан вкладки раньше ПОЛНОСТЬЮ заменял предыдущий
результат (`setScans` перезаписывал запись по `tabId`) — переход на другую
страницу той же вкладки и повторный скан стирал всё найденное раньше.
`TabAssetScan.assets` (плоский список) заменён на `TabAssetScan.batches:
PageAssetBatch[]` — по одной записи на каждый уникальный URL, отсканированный
в этой вкладке. `scanActiveTab()` (`BrowserPane.tsx`) теперь при каждом скане
сравнивает новый результат с объединением ВСЕХ прежних `batches` по `asset.data`
(дедуп по содержимому data: URL, не по `asset.id` — тот нумеруется заново в
каждом скане и не годится как устойчивый ключ "уже видели" между разными
сканами), оставляет только реально новые ассеты и либо добавляет их в
существующую партию (тот же URL — повторный скан той же страницы), либо
создаёт новую партию (навигация на другой URL). `AssetsPanel.tsx` рендерит
`batches` вложенно внутри группы вкладки — подпись "с какой страницы"
(`.assets-page-batch-caption`) показывается ТОЛЬКО когда партий больше одной
(на самой обычной странице — одна вкладка, один скан — не дублирует и так
показанный заголовок группы). Ключи React/action-state везде переведены с
`tabId:assetId` на `tabId:asset.data` по той же причине, что и дедуп — `id`
не уникален между сканами. Live-проверено на реальной навигации между двумя
страницами wikipedia.org в одной вкладке: первый скан — 9 тайлов, переход
на другую страницу + второй скан — 2 партии, +2 НОВЫХ уникальных тайла (итого
11, остальное с новой страницы оказалось дубликатами уже виденного и не
добавилось), третий скан БЕЗ навигации — 11 тайлов, без изменений.

**Отдельно: во время этой правки диск C: пользователя закончился (0 байт
свободно) — typecheck/build/test физически не могли писать temp-файлы.**
Не имеет отношения к размеру самого репозитория (~500MB со всеми
node_modules) — сторонняя проблема на машине пользователя. Работа
приостановлена с прямым объяснением, а не попыткой самостоятельно чистить
диск пользователя вслепую; после того как пользователь освободил место
(1.4GB), просто переспросил "пробуй" — все проверки выше проведены после
этого. **Стоит помнить**: если снова появится ошибка вида "No space left on
device" в bash-командах этого проекта — это, скорее всего, не баг в коде,
а внешняя нехватка места, проверить `df -h` вместо того, чтобы чинить код.

**Тут же, следующим сообщением: "перешёл на другой домен, а иконки википедии
остались в панели".** Аккумуляция из предыдущего пункта была привязана
только к `tabId`, без учёта того, что накопленные `batches` относятся к
СОВЕРШЕННО ДРУГОМУ сайту — переход на другой домен в той же вкладке
продолжал дописывать в тот же список, вместо того чтобы начать заново.
Добавлено `TabAssetScan.domain` (хост через `new URL(url).host`, тот же
паттерн, что `hostFromUrl` в `LeftSidebar.tsx`) — `scanActiveTab()` сравнивает
домен текущего скана с сохранённым; совпадает — накопление как раньше (дедуп
по `asset.data` внутри домена); НЕ совпадает — `priorBatches` обнуляется,
новый скан стартует с чистого листа для нового домена (старые партии
чужого сайта не участвуют в дедупе и не остаются в списке). Live-проверено
полным циклом: скан wikipedia.org (9 тайлов) → переход на другой домен
(ris.pxls-cdn.ru, с реальным контентом) → скан → заголовок и тайлы ПОЛНОСТЬЮ
заменились (26 новых), групп в панели ровно одна, не две — старые
википедийные иконки не остались висеть.

**Следующее сообщение: "надо добавить автоскан при загрузке страницы".**
`scanActiveTab()` теперь вызывается автоматически на переходе активной
вкладки `isLoading: true → false` (используются уже существующие
`did-start-loading`/`did-stop-loading` в `main/browser.ts`, дополнительных
IPC/main-изменений не потребовалось). **Первая версия ловила переход через
`useEffect` от уже отрендеренных `tabsState`/`activeTab` — живая проверка
поштучным опросом `browserGetTabs()` во время реальной навигации поймала
реальный баг: на быстрой загрузке (маленькая страница/из кэша) main-процесс
шлёт `isLoading:true` и почти сразу следом `isLoading:false`, React 18
сливает оба `setState` в один рендер, и промежуточное `true` снаружи никогда
не видно — эффект молча пропускал переход, автоскан просто не срабатывал.**
Исправлено переносом слежения ВНУТРЬ самого колбэка `onTabsState` — там
каждое IPC-сообщение `browser:tabs` обрабатывается поштучно, до всякого
React-батчинга; заодно `tabsStateRef.current` теперь обновляется прямо в
этом колбэке (не только в теле рендера), чтобы `scanActiveTab()` при вызове
из автоскана видел актуальные url/title, а не то, что успело закоммититься
рендером. Переключение на уже загруженную вкладку не триггерит скан —
проверяется, что переход именно `isLoading` У ТОЙ ЖЕ вкладки, что грузилась
на предыдущем сообщении. Live-проверено: навигация БЕЗ единого клика по
кнопке скана — тайлы и заголовок группы в панели появляются сами; переход
на другой домен (github.com, тяжёлая страница) — автоскан отработал и
корректно заменил содержимое (60 новых тайлов, старый домен не остался).

**Следующее сообщение, со скриншотом: "иконки импортируются не в нативном
соотношении сторон".** `createAssetNode()` в `renderers/asset.ts` для SVG
звал `vector.resize(payload.width, payload.height)` — Figma-метод `resize`
тянет ширину и высоту НЕЗАВИСИМО друг от друга. `payload.width/height` —
box model КОНТЕЙНЕРА со страницы (`DOM.getBoxModel`, `assetScanner.ts`), а
не собственный `viewBox` SVG — если сайт вписывает иконку в контейнер другой
пропорции (напр. `preserveAspectRatio`/`object-fit`, обычная практика для
квадратных иконок-кнопок с непрямоугольным контентом типа флага+подписи),
`resize()` растягивал картинку под пропорцию КОНТЕЙНЕРА, а не сохранял
собственную — на странице искажения не было (там масштабирование идёт по
правилам SVG/CSS), в Figma было. Исправлено на `vector.rescale(scale)` —
Figma-метод, масштабирующий ОДНИМ коэффициентом с сохранением пропорций;
`scale = min(width/vector.width, height/vector.height)` — "вписать" (как
`object-fit:contain`), не "растянуть". Live-проверено отправкой реально
неквадратной иконки (194×34, полученной живым сканом) через bridge в
подключённую Figma-сессию — прошла без ошибки (`ok:true`), но САМ визуальный
результат внутри Figma эта сессия проверить не может (нет Figma MCP, только
десктоп↔bridge↔plugin-relay видно живьём) — плюс plugin.code уже
пересобран (`dist/code.js`), но реальная Figma могла успеть загрузить его
ДО пересборки и держит старую версию в памяти до re-run/reload плагина —
как и раньше в этой сессии, тут нужна ручная проверка пользователем.

**Следующее сообщение, со скриншотом: выбор крупного блока Wikipedia
"засрал всю правую панель" повторяющимися диагностиками.** `InspectorPanel.tsx`
рендерил `diagnostics.map((d,i) => <div>{d.message}</div>)` — по одной
строке на КАЖДОЕ вхождение диагностики, без группировки. У большого
rich-text блока (десятки вложенных `<a>`/`<b>`/`<span>` и non-flex
контейнеров) один и тот же код диагностики (`block-layout-approximated`,
`mixed-inline-text-not-captured` и т.д.) срабатывает на каждом подходящем
узле — список превращается в стену из десятков одинаковых строк. Исправлено
группировкой по `ConversionWarning.code` (стабильный категориальный
идентификатор, не текст сообщения) в `Map` перед рендером — теперь ОДНА
строка на отдельный вид диагностики, с бейджем `× N`, если сработало
несколько раз. **Скор Import Quality по-прежнему считается по ПОЛНОМУ
недедуплицированному списку** (`computeConfidenceScore(diagnostics)`, не
тронут) — штраф корректно растёт с числом затронутых узлов, схлопывание
только для отображения списка. **Не live-проверено вживую**: чтобы
воспроизвести исходный баг, нужен реальный клик пикером по большому блоку
на реальной странице — синтетический второй CDP-клиент не может кликнуть
во время `Overlay.setInspectMode` (тот же давний, не раз задокументированный
в этом файле лимит), а `ElementPicker.lastSelectionResult` из скриншота
пользователя не пережил перезапуск dev-сервера в этой сессии. Изменение
чисто в отображении уже корректных данных (группировка по `Map`, без
изменения самого конвейера конвертации) — низкий риск, но честно не
подтверждено визуально, полагается на typecheck/build/test + ревью кода.

**Дальше пользователь спросил "почему так сыпется на википедии, есть ли
вариант нормально импортить с таких сайтов?" — объяснение без кода
(block-flow вместо flex + смешанный текст, п.3 из исходного списка фич), а
на "делай" сразу приступил к п.3: "Смешанный текст".**

**Смешанный текст (feature #3 из исходного списка пользователя, done
2026-08-20).** Раньше `<p>текст <b>жирный</b> ещё текст</p>` конвертировался
с потерей: вложенные теги (`<b>`) становились отдельными узлами, а "голый"
текст вокруг них молча пропадал (diagnostic `mixed-inline-text-not-captured`
как единственный след потери). Теперь такой контент разворачивается в ОДИН
`type:'text'` узел со стилизованными диапазонами (`DesignNode.textRuns`) —
жирный/цвет/декорация каждого прогона сохраняются по отдельности, как в
оригинале.

Модель данных: `TextRunSchema` (design-ast/schema.ts) — `{text, typography,
color}` на каждый прогон, теми же типами, что и у узла целиком. `DesignNode`
получил `textRuns?: TextRun[]` — взаимоисключающе с `text` (один узел
использует либо то, либо другое, никогда оба).

Захват (apps/desktop/src/main/domSnapshot.ts): `extractTextContent()`
заменил `extractDirectText()` — для смешанного контента (есть и дочерние
элементы, и текстовый узел где-то в поддереве) пробует
`extractTextRuns()` — рекурсивно разворачивает поддерево в плоский список
`{text, style}`, но ТОЛЬКО если КАЖДЫЙ вложенный элемент — "чисто инлайновый"
тег форматирования из allowlist `INLINE_TEXT_TAGS` (`B/STRONG/I/EM/U/S/
STRIKE/SPAN/A/SMALL/MARK/SUB/SUP/CODE/ABBR/CITE/Q/TIME/LABEL`, `BR` → буквальный
`\n`). Если среди вложенных попался НЕ инлайновый тег (картинка, блочный
элемент и т.п.) — `null`, откат на старое поведение (`droppedInlineText`) —
Figma TextNode не умеет встроенные картинки внутри текста, для такого
контента разворачивание в один узел в принципе невозможно, не только не
реализовано. Стиль каждого прогона — computed style ЕГО НЕПОСРЕДСТВЕННОГО
родителя (браузер уже резолвил каскад в CDP computed style, вручную
наследование считать не нужно) — эти данные уже собраны обычным обходом
дерева (INLINE_TEXT_TAGS не в SKIP_TAGS), новых CDP-запросов не потребовалось.
`trimRunsEdges()` обрезает только КРАЙНИЕ пробелы всего развёрнутого текста
(как браузер обрезает видимый текст блока по краям) — внутренние прогоны
сохраняют пробел на границе (иначе "Some " перед `<b>` потеряло бы
разделяющий пробел при склейке с "bold").

Конвейер (conversion-engine/convertElement.ts): `hasTextRuns` включён в
`isTextLeaf` наравне с `hasPlainText` — узел становится `type:'text'` и не
получает `children` (та же причина, что и у обычного текстового листа:
вложенные элементы уже вошли в результат, не нужны отдельными узлами).
Каждый прогон парсится ТЕМИ ЖЕ функциями (`parseTypography`/`parseColor`),
что и typography/цвет узла целиком — просто применёнными к computed style
конкретного инлайн-элемента вместо computed style контейнера, единая точка
разбора CSS→AST. `apps/desktop/src/main/domSnapshot.ts` дополнительно НЕ
строит дочерние `DomSnapshotNode` для успешно развёрнутого узла (были бы
всё равно отброшены на уровне conversion-engine, но так дешевле и яснее).

Figma-рендерер (`renderers/textNode.ts`): новая `createMixedTextNode()` —
конкатенирует текст всех прогонов, грузит ВСЕ уникальные (family, style)
шрифты ДО `createText()`/`characters` (Figma требует загруженный текущий
шрифт при любом изменении текста узла), затем `setRangeFontName`/
`setRangeFontSize`/`setRangeFills`/`setRangeTextCase`/`setRangeTextDecoration`/
`setRangeLetterSpacing` по каждому диапазону. Выравнивание/интерлиньяж —
общие на весь узел (из typography КОНТЕЙНЕРА, не прогона — так же наследуются
в CSS, инлайновые теги их не переопределяют). "Стили проекта" (styleMatching)
сознательно НЕ применяются к диапазонам в этом срезе — per-range сопоставление
с каталогом умножило бы сложность без отдельного запроса пользователя; попутно
исправлен реальный, пусть и мелкий, тип-баг: `toTextCase`/`toTextDecoration`
в `typography.ts` были типизированы как `TextNode['textCase']`/
`['textDecoration']` (шире, чем нужно — те типы включают `figma.mixed`, т.к.
ЧТЕНИЕ свойства может дать mixed), из-за чего `setRangeTextCase`/
`setRangeTextDecoration` (принимают только УЗКИЙ `TextCase`/`TextDecoration`)
не типчекались — сужены до фактически всегда возвращаемых конкретных типов.

**Live-проверено — и это прямое исправление бага из скриншота
пользователя**: временный debug IPC-хендлер (добавлен, использован,
полностью удалён — не оставлен в коде) конвертировал по CSS-селектору РЕАЛЬНЫЙ
абзац "Pat O'Keeffe..." с главной страницы en.wikipedia.org (ровно тот, что
раньше засыпал панель диагностиками) в обход клика пикером (та же причина,
что и раньше в этом файле — второй CDP-клиент не может кликнуть во время
`Overlay.setInspectMode`). Результат: `type:'text'`, `textRuns` — 30+
диапазонов, жирное имя "Pat O'Keeffe" (fontWeight 700), каждая вики-ссылка
("middleweight", "Billy Papke", "Jack Johnson"...) — со своим цветом
(вики-синий, `rgb(51,102,204)`) отдельным прогоном, обычный текст между
ними — тёмно-серым, **`diagnostics: []` — ни одной диагностики**, весь
текст сохранён. `pnpm -r typecheck/build/test` — 102 теста, все проходят
(5 новых в `text.test.ts`: успешный захват, отсутствие диагностики при
успехе, независимый парсинг per-run из СВОЕГО style, валидация по
DesignNodeSchema, отсутствие children). **Не проверено**: реальное
размещение получившегося TextNode внутри настоящей Figma (нужен клик
пикером + Import as Frame — тот же клик-лимит, что и выше; код
`createMixedTextNode` проверен typecheck'ом и ревью, но не глазами внутри
Figma).

**Следующее сообщение: "если в ассет панели загружено много ассетов, она
подлагивать начинает".** Три независимые причины, все реальные:

1. **Растровые превью рендерились из ПОЛНОРАЗМЕРНЫХ байт** — сканер
   (`assetScanner.ts`) намеренно отдаёт растр без уменьшения (до 8MB) ради
   "Отправить в Figma"/"Скопировать" (нужен оригинал), но панель кормила
   ТЕ ЖЕ байты напрямую в 72px `<img>` — браузер декодировал полноразмерное
   изображение ради миниатюры, помноженное на число накопленных ассетов
   (см. domain-scoped аккумуляцию выше). Новый `renderer/src/assetThumbnail.ts`
   (`makeThumbnail`) — уменьшает до 160px через offscreen `<canvas>`
   (`Image` → `drawImage` в уменьшенный canvas → `toDataURL('image/jpeg',
   0.82)`) ПРЯМО В РЕНДЕРЕРЕ (не main-процессе — Node не имеет декодирования
   картинок без нативной либы вроде `sharp`, а добавлять новый нативный
   бинарник ради этого рискованно, см. [[feedback-electron-native-deps]];
   Canvas API в рендерере — тот же Chromium, ничего нового не требуется).
   Вызывается в `BrowserPane.scanActiveTab()` для НОВЫХ растровых ассетов
   ПОСЛЕ дедупа (уже виденные не миниатюризируются повторно), оригинал
   (`asset.data`) не трогается — `AssetTile` рендерит `asset.thumbnail ??
   asset.data`, Copy/Send по-прежнему получают `asset` целиком (оригинал).
   Live-проверено: реальный растровый ассет с github.com — рендер использует
   именно миниатюру (`src` начинается с `image/jpeg`, ~2.2KB вместо
   оригинальных ~46KB), `naturalWidth>0` у всех проверенных тайлов (не
   сломалось отображение).

2. **Клик Copy/Send на ОДНОМ тайле перерисовывал ВСЕ тайлы** — `actions`
   (Record с состоянием кнопок) хранился в `AssetsPanel`, а колбэки
   `onCopy`/`onSend`/`onPreview` создавались НОВЫМИ инлайновыми стрелками на
   каждый тайл при каждом рендере `PageBatch` — даже обернув `AssetTile` в
   `React.memo`, сравнение по ссылке никогда бы не совпадало из-за этих
   новых замыканий. Исправлено: `copy`/`send`/`setAction` в `AssetsPanel`
   обёрнуты в `useCallback` (стабильная идентичность), `AssetTile` получает
   СТАБИЛЬНЫЕ `onCopy`/`onSend`/`onPreview` напрямую (не пред-привязанные
   закрытия) плюс `asset`/`actionKey` как отдельные пропсы, сам решает,
   что передать при клике — теперь `memo()` реально пропускает рендер
   тайлов, чьи пропсы не изменились. Live-проверено: клик Copy/клик по
   тайлу (открытие lightbox) по-прежнему работают корректно после рефакторинга
   (галочка показывается, lightbox открывается) — функциональных регрессий нет.

3. **Аккумуляция по доменам (см. выше) не имела верхнего предела** —
   автоскан на каждой загрузке страницы (см. выше) копил бесконечно за
   долгую сессию на одном сайте с множеством страниц. Новый
   `MAX_TOTAL_ASSETS_PER_DOMAIN = 500` в `BrowserPane.tsx` — при превышении
   `capBatches()` роняет СТАРЕЙШИЕ партии ЦЕЛИКОМ (не режет ассеты внутри
   партии по одному — партия показана целиком или не показана вовсе, иначе
   подпись "с какой страницы" стала бы нечестной обрезанным списком).
   Переиспользует уже существующий флаг `truncated` (тот же, что и для
   лимита одного скана) — отдельного UI не потребовалось. **Не проверено
   вживую** — воспроизвести 500+ реальных уникальных ассетов за разумное
   время сканирования непрактично; `apps/desktop` не имеет unit-тестов
   вообще (весь live-verification-driven, ни одного `.test.ts` в этом
   приложении) — логика `capBatches` (сумма/цикл с конца) проверена
   ревью кода, не автоматическим тестом и не живым сценарием.

Заодно исправлена гонка при параллельных сканах одной вкладки (латентная,
не новая, но замечена при рефакторинге под миниатюры): дедуп/сборка партий
внутри `setScans` теперь всегда читает `prev[activeTabId]` СВЕЖИМ на момент
записи, а не из значения, захваченного ДО await генерации миниатюр —
иначе результат конкурентного скана той же вкладки (напр. быстрый клик по
кнопке скана посреди автоскана) мог бы перезаписаться.

## Дистрибуция: установщики + автообновление (2026-08-20)

Пользователь попросил собрать установщики под Windows/Mac и настроить
автообновление через GitHub, тем же паттерном, что в его собственном
репозитории [[reference-skill-tree-design]] (`SWYOD/Skill-tree`) — тот уже
клонирован и изучен вживую (структура `package.json`'s `build`, `src/main/
autoUpdater.ts`, `UpdateBadge.tsx`) вместо угадывания конфига с нуля.

**electron-builder** (`apps/desktop/package.json`'s `build` блок) — `publish:
{provider:'github', owner:'SWYOD', repo:'web-to-figma'}`, Windows-таргеты
`nsis`+`portable`, Mac-таргеты `dmg`+`zip` (x64+arm64, без подписи Apple
Developer ID пока — осознанный компромисс на этом этапе, как и в Skill-tree).
Скрипты `dist:win`/`dist:mac`/`dist:all` — локальная сборка БЕЗ публикации
(`--publish never`), релиз собирается и загружается на GitHub отдельным
шагом (`gh release create`), тем же образом, что и в Skill-tree — там тоже
нет `.github/workflows`, только ручная локальная сборка на каждой ОС.

**electron-updater** (`main/autoUpdater.ts`, `UpdateBadge.tsx`,
`preload/index.ts`, `shared/types.ts`'s `UpdateStatus`/`UpdateReadyInfo`) —
скопировано у Skill-tree 1:1 по смыслу: скачивание автоматическое
(`autoDownload:true`), установка только по явному клику пользователя
(`autoInstallOnAppQuit:false` + кнопка "Перезапустить для обновления" в
`.settings-anchor`, над кнопкой "Настройки" — то же место, что в Skill-tree).
В dev-режиме (`!app.isPackaged`) проверка обновлений не бьёт по реальному
GitHub (там ещё нет релизов для локальной сборки) — сразу отдаёт понятный
статус вместо шума сетевых ошибок; фоновый автопроверяльщик (`scheduleUpdateChecks`,
раз в 4 часа) в деве вообще не запускается.

**Иконка приложения** (`build/icon.png`, 1024×1024) — готового бренд-ассета
не было, сгенерирована программно через Canvas API прямо в живом рендерере
приложения (`Runtime.evaluate` по тому же CDP-каналу, что все debug-скрипты
в этой сессии) — попытка отрендерить SVG через отдельный HTML-файл в
Browser pane не сработала: локальные файлы там рендерятся статическим
снапшотом с `script-src 'none'`, скрипты физически не выполняются
(ограничение самого инструмента, не баг). Простой плейсхолдер: "окно
браузера → рамка" на фиолетово-индиговом градиенте — не копирует чужой
бренд (сознательно не имитирует сам логотип Figma, чтобы не создавать
даже отдалённый trademark-конфликт в публичном репозитории).

**Реальный баг, пойманный живой проверкой уже ОПУБЛИКОВАННОГО релиза, не
раньше:** `artifactName` использовал `${productName}` = `"Web To Figma"`
(с живым пробелом) — локально файлы собрались корректно с пробелом в
имени, но при загрузке на GitHub Releases (`gh release create`) GitHub
переименовывает assets, заменяя пробелы на ТОЧКИ (`Web.To.Figma-...`), а
`electron-updater`'s `GitHubProvider` при построении URL для скачивания
обновления заменяет пробелы на ДЕФИСЫ (`p.replace(/ /g, "-")`, исходники
проверены напрямую) — точка ≠ дефис, реальный автообновляющийся клиент
слал бы запрос на несуществующий путь и ловил 404 при каждой попытке
обновиться. Пойман НЕ по документации/памяти, а прямой проверкой: создан
релиз, `gh release view --json assets` показал реальные имена файлов на
GitHub, сверены с `latest.yml` — расхождение обнаружено сразу. Исправлено
заменой `${productName}` на литеральный `Web-To-Figma` (без пробелов) во
всех трёх `artifactName` (top-level/nsis/portable) — `productName` (только
отображаемое имя приложения в ОС) не тронут, там пробел не проблема.
Пересобрано, релиз пересоздан, финально проверено `curl -I` по ТОЧНО тому
URL, что построил бы `electron-updater` из свежего `latest.yml` — реальный
`200 OK`, не предположение.

**Границы этой сессии**: Mac-сборка невозможна с Windows —
`electron-builder --mac` прямо и сразу отказывается
("Build for macOS is supported only on macOS"), не половинчатая попытка,
а жёсткий отказ инструмента; собран и опубликован (`v0.1.0`) только
Windows-релиз (`Setup.exe` + `portable.exe`). Для Mac нужен либо реальный
Mac пользователя (см. его же "на маке установщик собирался"), либо
GitHub Actions с `macos-latest`-раннером (в этом репозитории такого workflow
пока нет — сознательно, как и в Skill-tree, сборка предполагается ручной
локальной). Подпись (Apple Developer ID, code-signing для Windows) —
не настроена вообще, тот же осознанный компромисс "на этом этапе не
страшно", что пользователь прямо подтвердил.

## Регрессия от "смешанного текста": пилюли/бейджи ложно распознавались как inline-текст (2026-08-20)

Пользователь прислал скриншот реального сайта (`ris.pxls-cdn.ru`, блок тегов
новостей — ISO/IEC, Аккредитация, ГОСТ...): весь блок из ~29 отдельных
"пилюль" импортировался ОДНИМ текстовым слоем без единого стиля, вместо
рамок/заливок/скруглений каждой пилюли и layout между ними.

**Причина** — прямая регрессия от фичи "смешанный текст" (см. выше,
`extractTextRuns`/`INLINE_TEXT_TAGS`): allowlist проверял только ИМЯ тега.
Реальный сайт стилизует `<a>` под пилюлю через Tailwind arbitrary-value
классы (`tw:border tw:border-solid tw:bg-white ...`) — тег формально
"инлайновый форматирующий" (`A` есть в allowlist), но визуально это
самостоятельная фигура со своей рамкой/заливкой/скруглением, а не кусок
форматированного текста. `TextRun` (design-ast/schema.ts) физически не
умеет заливку/рамку/скругление НА ДИАПАЗОН, только typography+color текста
— разворачивание такого узла в textRuns БЕЗ дополнительной проверки тихо
теряло всю визуальную идентичность каждой пилюли и схлопывало flex-wrap
layout между ними в одну строку без пробелов.

**Фикс** (`apps/desktop/src/main/domSnapshot.ts`) — новая
`looksLikeInlineFormatting(style)`: тег из allowlist — необходимое, но
теперь НЕ достаточное условие. Дополнительно проверяется, что у ребёнка
НЕТ непрозрачного `background-color`, НЕТ видимой рамки (`border-*-style`
≠ `none` при ненулевой ширине) и НЕТ `box-shadow` — если хоть один вложенный
"инлайновый" тег визуально ведёт себя как коробка, весь разворот в
textRuns для ЦЕЛОГО поддерева отменяется (`extractTextRuns` возвращает
`null`), откат на старый путь: каждый элемент конвертируется сам по себе
(с заливкой/рамкой/скруглением — там это уже штатно работает). Данные для
проверки уже есть в `dataByBackendId` (тот же `CSS.getComputedStyleForNode`
round-trip, что и для остального дерева) — новых CDP-вызовов не потребовалось.

**Live-проверено на РЕАЛЬНОМ сайте пользователя**, тем же способом, что и
раньше (временный debug IPC-хендлер — добавлен, использован, полностью
удалён). По пути поймал ДВЕ отдельные проблемы, не связанные с самим
фиксом:
1. Установленная (не dev) копия приложения из ранее собранного `Setup.exe`
   молча висела в фоне и держала порт bridge-сервера (52847) — dev-сервер
   не мог стартовать окно, зависал без единой ошибки в логе (только
   `DevTools listening...`, без последующего `[main] bridge listening...`).
   Обнаружено через `netstat`+`wmic process` (PID держал именно
   `D:\4_Programs\Web To Figma\Web To Figma.exe`), закрыто через
   `taskkill`. Не баг кода — побочный эффект того, что установщик из этой
   же сессии оказался запущен параллельно с dev-режимом.
2. Debug-хендлер сам по себе не вызывал `DOM.enable`/`CSS.enable` после
   `dbg.attach()` — без них `CSS.getComputedStyleForNode` тихо падает
   для КАЖДОГО узла ("CSS agent was not enabled"), из-за чего
   `buildSnapshotTree` не находил box model даже для корневого элемента.
   Тот же паттерн уже документирован раньше в этом файле для похожей
   ошибки в `assetScanner.ts` — здесь наступил на те же грабли в новом
   temporary-коде, не в продовом пути (`inspector.ts` уже делает
   `DOM.enable`/`CSS.enable` правильно, см. его код).

После обоих устранений — реальный результат: `type:'frame'`, `name:'tags'`,
`layout:{mode:'horizontal', gap:12}`, 29 детей, каждый со своим текстом без
конкатенации (`ISO/IEC`, `Аккредитация`, `Аналитика`, ...), 29 диагностик
`text-background-dropped` — ОДНА НА ПИЛЮЛЮ (ожидаемо и корректно: каждая
пилюля — текстовый лист с непрозрачным фоном, ограничение Figma TextNode
уже задокументировано отдельно, не новое). До фикса — ноль диагностик и
один слепленный текстовый блоб; теперь — честная структура с честными
предупреждениями там, где заливка действительно теряется.

`pnpm -r typecheck/test` — 102 теста, все проходят (регрессионный тест на
уровне `conversion-engine` не добавлен: сам баг живёт целиком в
CDP-экстракции `apps/desktop/src/main/domSnapshot.ts`, а не в
`conversion-engine`, у `apps/desktop` по-прежнему нет unit-тестов вообще —
верификация только живым сценарием, тем же способом, что и раньше в этом
файле).

## v0.1.2: bridge-порт при провале старта, content-visibility на тайлах ассетов (2026-08-20)

Два независимых фикса по фидбеку пользователя.

**1. Провал старта bridge больше не блокирует окно целиком.** Живая
причина найдена случайно, в процессе многократных перезапусков dev-режима
за эту сессию: `await startBridge()` стоял ПЕРЕД `createWindow()` в
`app.whenReady().then(...)` без `try/catch` — если `bridgeServer.start()`
кидает (порт занят даже во ВСЁМ fallback-диапазоне, см.
`PORT_FALLBACK_RANGE=9` в `bridge-protocol/constants.ts` — за долгую сессию
с множеством перезапусков реально скопились процессы, державшие все 10
портов подряд), весь `.then()`-чейн падает, `createWindow()` никогда не
вызывается — ни окна, ни единой ошибки на экране, только `DevTools
listening...` в логе и тишина (симптом, который сам поймал дважды за эту
сессию, посчитав его сначала просто "занятым портом"). Обёрнуто в
try/catch — теперь отказ bridge только логируется, окно открывается в
любом случае (индикатор Bridge в toolbar покажет "не подключено", это уже
штатно обрабатывается).

**2. Освобождение bridge-порта продублировано на `before-quit`.**
`window-all-closed` уже вызывал `bridgeServer?.stop()` — рабочий путь для
обычного закрытия окна. Добавлен тот же вызов на `before-quit` — не
всегда идентичный путь (напр. programmatic `app.quit()` без предварительного
закрытия окна) — defense-in-depth, `stop()` безопасно вызывать повторно
(внутри уже `?.close()` на nullable-полях). Не панацея от ЛЮБОЙ причины
зависшего порта (напр. `taskkill -F` без штатного quit-пути всё равно не
даст коду шанса на cleanup — тут ничего не поделать на уровне приложения),
но закрывает конкретный пробел, из-за которого несколько раз за эту сессию
копились держащие 52847+ процессы.

**3. `content-visibility:auto` на `.asset-tile`** — по жалобе "всё равно
подтормаживает" ПОСЛЕ уже сделанных ранее фиксов (уменьшенные превью, memo,
потолок в 500 ассетов, см. выше). Те фиксы снижают стоимость КАЖДОГО
тайла, но не устраняют главное: браузер всё равно делает layout/paint/
hit-test для сотен тайлов, даже полностью проскроленных за пределы видимой
области. `content-visibility:auto` — нативный CSS, без единой строчки JS,
без новой зависимости (полноценная virtualization типа react-window
рассматривалась, но не оправдана — ощутимо больше кода ради предполагаемо
небольшого дополнительного выигрыша сверх content-visibility, плюс ломает
Ctrl+F/скролл-к-элементу, чего content-visibility не делает).
`contain-intrinsic-size:72px 72px` резервирует место под тайл (тот же
размер, что и в `.assets-grid`), чтобы скроллбар не прыгал, пока браузер
ещё не просчитал реальный тайл. Live-проверено: 59 тайлов после скана
github.com, `getComputedStyle(tile).contentVisibility === 'auto'`,
офскрин-тайл всё ещё честно репортит `72×72` через `getBoundingClientRect`
(значит `contain-intrinsic-size` резервирует размер верно, скролл не
скачет) — **не измерено количественно** (FPS/профайлер недоступны в этой
среде), только качественно "меньше активной работы браузера за кадром вне
вьюпорта", логика метода такая же, как у любого content-visibility
oптимизации.

`pnpm -r typecheck/test` — 102 теста, все проходят. Версия поднята до
0.1.2 (bridge-протокол/perf — не layout-фича из тех, что обычно ждут
пересборки, но раз уж собираем релиз повторно за эту же сессию — тот же
`dist:win`+`gh release create` цикл, что и для 0.1.1).

## Design Agent bridge — плагин Figma умеет говорить на протоколе DesignAgent (2026-08-20)

Пользователь хочет параллельную работу: он вручную тащит контент через Web
To Figma, а AI (через MCP-тулы DesignAgent) в это же время правит тот же
Figma-файл. Figma физически не даёт держать два плагина открытыми
одновременно ("почему у меня появилась эта идея" — именно поэтому). Решение
— не отдельный плагин, а ВТОРОЙ независимый канал внутри плагина Web To
Figma (переименован в **Bridge Tools**, см. ниже): он подключается к тому же
локальному WebSocket-брокеру, что и настоящий DesignAgent
(`ws://localhost:3790`), и говорит на его же протоколе — тогда MCP-тулы
DesignAgent, ничего не зная о подмене, работают против ЭТОГО плагина.

**Как нашли протокол** — не документацией "снаружи", а прямым чтением
реальных исходников DesignAgent, установленных локально:
`C:\Users\ilya\.claude\plugins\cache\designagent\designagent\0.20.0\mcp\src\
broker.ts`/`server.ts` (протокол брокера) и dev-сборка самого плагина
`C:\Users\ilya\.claude\designagent-figma-dev\dist\code.js.map` (source map
со встроенным `sourcesContent` — весь исходный `code.ts`, 105KB, восстановлен
дословно через `map.sourcesContent`, без сторонних инструментов). Пользователь
прямо указал на этот путь после того, как я по инерции сказал "у меня нет
доступа к логике DesignAgent" — неверно: доступ был, просто не посмотрел.

**Протокол брокера** (`broker.ts`): отдельный процесс-демон держит порт 3790
(НЕ сам плагин и НЕ MCP-сервер — оба подключаются к НЕМУ как клиенты).
Рукопожатие плагина: `{type:'hello', role:'figma-plugin'}` →
`{type:'hello_ack', serverInstanceId, pid}`. Вызов тула: брокер шлёт плагину
`{type:'request', id, command, params}`, плагин отвечает `{type:'response',
id, ok, result|error}`. `{type:'ping'}` → отвечаем `{type:'pong'}`.
Reverse-channel (`server_request`, файловые операции брокер→Claude) не
реализован — ни одна портированная команда его не требует.

**Портировано 31 из 34 команд** DesignAgent (`apps/figma-plugin/src/main/
designAgentCommands.ts`) — максимально ДОСЛОВНО из реального рабочего кода
(не переизобретено по описанию): status, list_page_nodes, list_children,
list_variables_and_styles, focus, select, annotate, apply_fix,
create_frame/rectangle/ellipse/text, set_text, set_fill/stroke/corner_radius/
shadow/text_style/image/opacity/rotation, bind_fill_variable,
bind_stroke_variable, apply_text_style, set_instance_property, place_image,
move, resize, reparent, delete, clone, group, ungroup, rename,
instantiate_component, set_grid, list_shaders, set_shader,
list_animation_styles, apply_animation, remove_animation, get_animations,
batch, take_screenshot, export_asset, console_logs. **НЕ портированы**:
`get_spec`, `get_design_md`, `export_tokens` — опираются на отдельный,
гораздо более объёмный конвейер экстракции/анализа DesignAgent
(extract.ts/analyze.ts/serialize.ts/designdoc.ts/tokens.ts, суммарно ~70KB
исходников) — читающий путь, самостоятельная задача, оставлена как Phase 2
(понятная ошибка вместо "Unknown command" при попытке вызвать).

Второе, независимое соединение — `apps/figma-plugin/src/ui/
designAgentClient.ts` (браузерный `WebSocket`, тот же reconnect-паттерн, что
у `BridgeClient` из `bridge-protocol`, но свой протокол — сырой JSON, не
`bridge-protocol`'s codec). UI не имеет доступа к `figma.*` (только main
sandbox) — команда релеится через `postMessage` (`code.ts`: новый тип
сообщения `da-command`/`da-result`). `manifest.json` — добавлен
`ws://localhost:3790`/`http://localhost:3790` в `networkAccess.allowedDomains`.
UI — новая секция "Design Agent" в `App.tsx` рядом с существующей секцией
Web To Figma, тумблер Start/Stop, статус (та же цветовая индикация, что у
основного bridge).

**Живая регрессия, пойманная СРАЗУ при первом реальном запуске** (не
типчеком — таких ошибок typecheck не ловит): код-патчинг `console.*` в
кольцевой буфер логов (`console[level] = ...`) предполагал, что ВСЕ уровни
(`log/info/warn/error/debug`) существуют как функции — в песочнице
Figma-плагина (QuickJS, не полноценный V8) это не гарантировано, `console
[level].bind` на `undefined` бросал `TypeError: cannot read property 'bind'
of undefined` при загрузке плагина. Фикс — пропускать уровни, которых нет,
до `.bind`.

**Live-верификация** — не синтетика, реальные вызовы через
`mcp__plugin_designagent_designagent__*` (те же MCP-тулы, что подключаются к
НАСТОЯЩЕМУ DesignAgent) против РЕАЛЬНОГО файла пользователя ("РИС site
Main"): `status`/`list_page_nodes`/`list_children` — корректно читают
реальное дерево (94 узла верхнего уровня, включая `tags` из фикса пилюль
ранее в этой же сессии); `create_frame`+`create_text`+`set_fill`+`set_stroke`
+`clone`+`take_screenshot`+`delete` — создан, стилизован и удалён тестовый
композит (тёмный фрейм со скруглением/рамкой, жирный цветной текст,
клонированный и перекрашенный дубликат), подтверждено скриншотом и повторным
чтением дерева. Один пограничный случай зафиксирован, не являющийся багом
порта: `clone` без явного `parentId` не всегда сохраняет исходного родителя
(текстовый клон приземлился на странице, а не внутри фрейма-родителя) —
воспроизводит РЕАЛЬНОЕ поведение апстрима (код скопирован дословно,
логика идентична), не регрессия порта.

**Переименование по запросу пользователя**: сам плагин (`manifest.json`
`name`) — "Web Importer" → **Bridge Tools** (стал шире одной функции —
теперь это canvas-bridge для DESKTOP-приложения И для AI/DesignAgent).
Заголовки секций внутри UI (`App.tsx`, было "Web Importer" трижды) →
**Web To Figma** — теперь имя продукта, а не общее описание функции; секция
"Design Agent" рядом с ней получила отдельный заголовок. Подсказка в
desktop-приложении (`BridgePopover.tsx`, "Плагин Web Importer подключается
сам...") тоже обновлена на новое имя — иначе пользователь искал бы в Figma
несуществующий плагин.
