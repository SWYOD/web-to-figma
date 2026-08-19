# Development

## Требования

- Node.js ≥ 20 (проверено на v24)
- pnpm ≥ 9 (`corepack enable` включит нужную версию из `packageManager` в
  корневом `package.json`)

## Установка

```bash
pnpm install
```

## Запуск в dev-режиме

```bash
pnpm dev              # desktop + figma-plugin параллельно (turbo --parallel)
pnpm dev:desktop      # только Electron-приложение (electron-vite dev)
pnpm dev:plugin       # только сборка figma-plugin в watch-режиме
```

`figma-plugin` не имеет "dev server" в привычном смысле — Figma сама
загружает локальный плагин через **Plugins → Development → Import plugin from
manifest…**, указав на `apps/figma-plugin/manifest.json`. `pnpm dev:plugin`
пересобирает `code.js`/`ui.html` при изменениях; чтобы увидеть новую версию,
плагин нужно перезапустить в Figma (Figma не делает hot-reload плагинов
автоматически).

## Bridge: как проверить, что связка работает

1. Запустить `pnpm dev:desktop` — в toolbar приложения должен появиться
   индикатор `Bridge: waiting…` и код подключения (Settings → Bridge).
2. В Figma (desktop-приложение Figma или figma.com) импортировать плагин из
   `apps/figma-plugin/manifest.json`, запустить его.
3. При первом запуске плагин попросит ввести код подключения — вставить код
   из шага 1.
4. Оба UI должны показать `Connected` в течение секунды.

### Порт занят / соединение не устанавливается

- Проверить `app.getPath('userData')/bridge.json` (Windows:
  `%APPDATA%/web-to-figma/bridge.json`) — там указан реальный порт, на
  котором слушает сервер, если дефолтный `52847` был занят.
- Локальный firewall/AV иногда блокирует новые процессы, слушающие TCP —
  первый запуск может потребовать разрешить `web-to-figma` в диалоге ОС.
- Figma Plugin `manifest.json` должен перечислять используемый порт в
  `networkAccess.allowedDomains`/`devAllowedDomains` — если порт менялся
  вручную для отладки, манифест нужно обновить.

## Typecheck / build

```bash
pnpm typecheck   # tsc --noEmit во всех пакетах через turbo
pnpm build       # production-сборка desktop + figma-plugin
```

## Структура веток пакетов при разработке

`packages/design-ast`, `packages/bridge-protocol`, `packages/shared`,
`packages/ui` собираются как обычные TS-библиотеки (`tsc -b` / `tsup`, см.
`package.json` каждого пакета) — `apps/desktop` и `apps/figma-plugin` тянут их
через workspace-протокол (`workspace:*`), пересборка зависимостей в dev-режиме
идёт через `turbo run dev --parallel` с `dependsOn: ["^build"]` в `turbo.json`
(зависимость пересобирается перед тем, как поднимается dev у потребителя).
