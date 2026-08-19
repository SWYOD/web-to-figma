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

→ далее расширение scope.
