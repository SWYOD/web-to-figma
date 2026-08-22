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
- Распознавание повторяющихся структур (карточки, списки, строки таблиц) — импортируются одним Figma Component + N Instance с override'ами текста/картинок, а не N одинаковыми фреймами.

**Импорт**
- **Import as Frame** — обычный импорт выбранного элемента.
- **Import as Component** — тот же элемент, но сразу как Figma Component; опционально рядом создаётся один Instance (настройка в правой панели). Для чистого текстового узла Figma не даёт сделать компонент — в этом случае тихий откат на Frame с уведомлением.
- **Мульти-выбор в очередь** — отдельная кнопка на тулбаре включает режим "выбирать по одному": после каждого клика пикером — попап "Добавить/Отменить", выбранные элементы копятся карточками в левой панели, отдельная кнопка батч-импортирует всю очередь разом в ряд.

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

**Bridge Tools для Figma (companion-плагин)**
- Один плагин вместо двух — Figma не даёт держать открытыми сразу несколько плагинов, поэтому импорт из Web To Figma и DesignAgent-мост живут в одном плагине.
- Приём импорта от desktop-приложения через локальный WebSocket (авто-обнаружение порта, без ручного ввода кода).
- Встроенный DesignAgent bridge — второй, независимый канал к тому же брокеру (`localhost:3790`), что и у официального плагина DesignAgent: можно параллельно тащить контент руками через Web To Figma, пока ИИ работает с тем же файлом через DesignAgent.

## 📦 Установка

### Desktop-приложение

Готовые сборки — на странице **[Releases](https://github.com/SWYOD/web-to-figma/releases/latest)**:

- **Windows** — установщик `.exe` или portable-версия — сборка без цифровой подписи, Windows SmartScreen при первом запуске покажет предупреждение («Windows защитила ваш компьютер») — «Подробнее» → «Выполнить в любом случае»
- **macOS** — `.dmg` (Intel и Apple Silicon) — сборка без подписи Apple Developer ID, при первом запуске macOS Gatekeeper потребует явного разрешения (System Settings → Privacy & Security → «Open Anyway»)

Приложение само проверяет обновления и предлагает установить новую версию при запуске. На macOS без подписи автоустановка может не сработать — тогда приложение подскажет поставить новую версию вручную из установщика.

### Figma-плагин «Bridge Tools»

Плагин не опубликован в Figma Community — устанавливается локально из исходников (dev-плагин через manifest):

1. Соберите плагин:
   ```bash
   pnpm install
   pnpm --filter @web-to-figma/figma-plugin build
   ```
   Это создаст `apps/figma-plugin/dist/` (`code.js` + `ui.html`).
2. В Figma desktop-приложении: **Plugins → Development → Import plugin from manifest…**
3. Укажите файл `apps/figma-plugin/manifest.json` из этого репозитория.
4. Плагин появится в Figma под именем **Bridge Tools** (Plugins → Development → Bridge Tools).
5. Запустите desktop-приложение Web To Figma, откройте Bridge Tools в нужном Figma-файле — плагин сам найдёт локальный порт и подключится (значок Bridge в тулбаре desktop-приложения покажет статус подключения).

После любого изменения кода плагина — пересоберите (`pnpm --filter @web-to-figma/figma-plugin build`) и заново откройте Bridge Tools в Figma (Development-плагины не обновляются "на лету", нужен ручной перезапуск).

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
