# Asset Model

Живёт в `packages/design-ast` (манифест — часть `DesignDocument`) и обслуживается
логикой `packages/asset-engine` (Phase 9 — **реализовано**). Этот документ
фиксирует модель данных и стратегию дедупликации/транспорта.

Реализованный extraction pipeline (Phase 9): `apps/desktop/src/main/domSnapshot.ts`
во время обхода CDP-дерева распознаёт `<img>` (растровые source) и inline
`<svg>` (векторные, не растрируются — `figma.createNodeFromSvg` на стороне
плагина), запрашивает байты через обычный `fetch()` из Electron main-процесса
(не `Page.getResourceContent` — см. architecture.md, находка про ненадёжность
этого CDP-метода для уже загруженных суб-ресурсов), нормализует/хеширует через
`packages/asset-engine`'s `AssetCollector`. `srcset`, CSS `background-image` и
доставка `ref`-транспорта по требованию — явно отложены на будущие срезы.

## Модель

```ts
type AssetKind = 'raster' | 'svg' | 'background' | 'icon'

type AssetTransport =
  | { mode: 'inline'; data: string } // base64, только для малых assets (см. лимит ниже)
  | { mode: 'ref'; token: string }   // desktop раздаёт по требованию через bridge (ImportAssetMessage)

interface DesignAsset {
  id: string             // стабильный id внутри документа (используется в AssetReference)
  kind: AssetKind
  sourceUrl?: string      // исходный URL на сайте (для "Reveal source"/диагностики)
  mimeType: string
  width?: number
  height?: number
  hash: string            // sha256 содержимого — основа дедупликации
  transport: AssetTransport
}

type AssetManifest = Record<string, DesignAsset>
```

## Дедупликация

Ключ дедупликации — **`hash` содержимого**, не URL (один и тот же спрайт может
быть доступен по разным URL с cache-busting query; разные `srcset`-варианты той
же картинки — разный hash, разные записи, это осознанно, т.к. Figma должна
получить конкретный использованный вариант).

Правило: при извлечении asset engine считает `sha256` над байтами (для raster/
SVG-как-текст — по нормализованному тексту без незначащих пробелов, чтобы два
идентичных SVG с разным форматированием не плодили дубликаты) **до** записи в
`AssetManifest`. Если hash уже есть в манифесте текущего документа — переиспользуется
существующий `id`, новый `DesignAsset` не создаётся. Это напрямую покрывает
fixture 9 из ТЗ (20 одинаковых SVG-иконок → одна запись).

## MIME/kind определение

Приоритет определения: (1) CDP `Network.getResponseBody`/`Page.getResourceTree`
даёт content-type из реального ответа сервера — предпочтительнее, чем
расширение в URL; (2) если недоступно — сниффинг по сигнатуре байт (magic
bytes: `\x89PNG`, `\xFF\xD8\xFF` JPEG, `RIFF....WEBP`, `GIF8`, `<svg`/`<?xml`
с последующим `<svg`); (3) расширение URL — последний fallback.

`kind` определяется так:
- SVG (inline `<svg>` или `.svg` ответ) → `'svg'`
- `<img>`/`<picture>`/`srcset` растровый → `'raster'`
- `background-image`/`mask-image` CSS → `'background'`
- Растровый/SVG asset ≤ порогового размера (напр. ≤ 64×64 CSS px) внутри
  интерактивного/декоративного элемента (`<button>`, `<a>`, класс с "icon") →
  `'icon'` (эвристика, не строгая — влияет только на группировку в Asset
  Panel, не на конвертацию).

## Транспорт через bridge

Локальный WebSocket без искусственного ограничения размера сообщения, но
инлайнить в **каждое** `ImportNodeMessage` все байты всех assets документа —
плохо (raster-тяжёлая страница раздувает сообщение до десятков МБ, блокируя
event loop на JSON.stringify/parse с обеих сторон).

Правило: 
- assets **до ~256 KB** после кодирования сериализуются `inline` прямо в
  манифесте вместе с `DesignDocument`;
- assets **больше 256 KB** передаются `ref` — манифест несёт только метаданные
  + `token`, а Figma Plugin запрашивает содержимое отдельным
  `GetAssetBytesMessage` (пагинированная бинарная передача чанками, см.
  `bridge-protocol.md`), которая инициируется рендерером непосредственно перед
  тем, как байты нужны (`figma.createImage`/вставка вектора).

Это осознанный компромисс Phase 9: простой путь для маленьких/типичных
ассетов (иконки, большинство UI-картинок), без необходимости сразу строить
chunked-протокол для MVP-сценариев (лендинги/дашборды/карточки, см. п.29 ТЗ,
где явно не требуется идеальная поддержка тяжёлых медиа-страниц).

## Serialization strategy

`DesignAsset` целиком (без байт) — обычный JSON, валидируется Zod-схемой в
`packages/bridge-protocol` (используя тип из `packages/design-ast`). Байты в
`inline`-режиме — base64 в том же JSON; в `ref`-режиме — отдельные
`ArrayBuffer`-фреймы WebSocket (бинарные, не JSON), сопоставляемые с `token`
через `requestId` конверта bridge-протокола.
