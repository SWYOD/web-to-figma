<div align="center">

# 🕸️ Web To Figma

**Desktop-инструмент, который переносит элементы реальных веб-сайтов в Figma** — встроенный Chromium-браузер, пикер элементов и bridge к companion-плагину Figma, без скриншотов и без вставки картинкой.

[![Release](https://img.shields.io/github/v/release/SWYOD/web-to-figma?label=release)](https://github.com/SWYOD/web-to-figma/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational)](#-установка)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## Что это

Web To Figma (шутки ради — WTF) открывает любой сайт во встроенном браузере, даёт кликнуть на любой элемент страницы — от одной кнопки до целого блока — и превращает его в настоящую редактируемую структуру в Figma: фреймы с Auto Layout, реальный текст (в том числе стилизованный вперемешку — жирный/ссылки/курсив внутри одного абзаца), картинки и SVG-иконки, тени, границы, скругления — не растровый снимок.

Никакого облака — всё общение с Figma идёт через локальный WebSocket-мост к companion-плагину, который вы устанавливаете в Figma отдельно (см. `apps/figma-plugin`).

## Возможности

**Захват со страницы**
- Пикер элементов прямо на встроенной странице — навёл, кликнул, получил дерево DOM-узлов вместе со стилями.
- Flex-раскладка конвертируется в настоящий Figma Auto Layout (направление, gap, отступы, выравнивание, fill-sizing).
- Реальный текст — включая смешанный инлайн-контент (`<b>`/`<a>`/`<i>`/... внутри одного абзаца) одним текстовым узлом со стилизованными диапазонами, а не потерей текста между тегами.
- Картинки и inline/внешние SVG — переносятся как настоящие ассеты, с дедупом по содержимому.
- Тени, границы, скругления, прозрачность, `overflow`/clip — конвертируются напрямую из computed style.

**Стили проекта**
- Опциональное сопоставление с существующими text/paint style или цветовыми Variables вашего Figma-файла вместо голых значений с сайта.
- "Apply to Selection" — перенести стили с любого элемента страницы на уже выбранный слой в Figma, без создания нового узла.

**Панель ассетов**
- Отдельная панель снизу — сканирует всю текущую страницу на иконки/картинки, отдельные сетки для тех и других.
- Копирование в буфер или прямая отправка в Figma по клику, полноэкранный просмотр с зумом.
- Накопление по мере навигации по одному сайту, сброс при переходе на другой домен.

**Рабочее пространство**
- Вкладки встроенного браузера, история недавних сайтов.
- Светлая/тёмная/системная тема, галерея тем + редактор своей темы.

## 📦 Установка

Готовые сборки — на странице **[Releases](https://github.com/SWYOD/web-to-figma/releases/latest)**:

- **Windows** — установщик `.exe` или portable-версия
- **macOS** — `.dmg` (Intel и Apple Silicon) — сборка без подписи Apple Developer ID, при первом запуске macOS Gatekeeper потребует явного разрешения (System Settings → Privacy & Security → «Open Anyway»)

Приложение само проверяет обновления и предлагает установить новую версию при запуске. На macOS без подписи автоустановка может не сработать — тогда приложение подскажет поставить новую версию вручную из установщика.

Companion-плагин для Figma — `apps/figma-plugin`, устанавливается в Figma отдельно (Import plugin from manifest, `apps/figma-plugin/dist/`).

## 📖 Документация

Архитектура, конвейер конвертации DOM→Figma, поддерживаемые CSS-свойства и модель ассетов — в [`docs/`](docs):
[architecture.md](docs/architecture.md) · [design-ast.md](docs/design-ast.md) · [conversion-rules.md](docs/conversion-rules.md) · [supported-css.md](docs/supported-css.md) · [asset-model.md](docs/asset-model.md) · [bridge-protocol.md](docs/bridge-protocol.md)

## Разработка

```bash
pnpm install
pnpm dev            # desktop + figma-plugin параллельно
pnpm dev:desktop     # только desktop-приложение
pnpm dev:plugin      # только UI Figma-плагина
```

Прочие команды:

```bash
pnpm build           # production-сборка всех пакетов
pnpm typecheck        # проверка типов по всему монорепо
pnpm test             # тесты (conversion-engine, figma-plugin, asset-engine)
```

Локальная сборка установщика (без публикации):

```bash
cd apps/desktop
npm run dist:win      # .exe установщик + portable
npm run dist:mac      # .dmg/.zip (нужен macOS)
```

## Стек

Electron · React · TypeScript · Vite (electron-vite) · Turborepo/pnpm workspaces · Chrome DevTools Protocol · Zod.

Монорепо: `apps/desktop` (Electron-приложение), `apps/figma-plugin` (companion-плагин), `packages/*` (design-ast, conversion-engine, bridge-protocol, asset-engine, ui, shared).

## Лицензия

MIT
