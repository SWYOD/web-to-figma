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

## 7. Roadmap (вертикальные срезы, из исходного ТЗ, без изменений порядка)

Phase 0 (документация) → Phase 1 (monorepo + Electron shell + Figma Plugin
shell + bridge + темы, **done**) → Phase 2 (встроенный браузер:
`WebContentsView`, адресная строка, back/forward/reload, favicon/title/loading
state — **done**, проверено live через CDP: реальная навигация на google.com
→ example.com, корректные title/favicon/canGoBack) → Phase 3 (element
picker) → Phase 4 (property extraction) → Phase 5 (Design AST)
→ Phase 6 (Figma renderer) → Phase 7 (Flex→Auto Layout) → Phase 8 (nested trees)
→ Phase 9 (asset engine) → Phase 10 (Apply to Selection) → Phase 11
(warnings/confidence score) → далее расширение scope.
