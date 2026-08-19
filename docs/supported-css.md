# Поддерживаемые CSS-свойства → Figma

Статус: заполняется по мере реализации `conversion-engine` (Phase 5-8) и
тестовых fixtures (`docs/architecture.md` roadmap). Источник детальных правил
вывода layout — `conversion-rules.md`; здесь — плоская таблица статусов для
быстрой сверки "что уже поддержано".

Статусы: ✅ поддержано · ⚠️ приближение (с warning) · ❌ не поддержано (fallback/skip) · ⏳ запланировано

| CSS свойство | Статус | Fixture | Примечание |
|---|---|---|---|
| `display: flex` (+ direction) | ✅ | 1 | Phase 7 |
| `gap` / `row-gap` / `column-gap` | ✅ | 1 | Phase 7 — по правильной оси (column-gap для row, row-gap для column) |
| `padding` | ✅ | 1, 2 | Собирается с Phase 5 (для любого узла), в Auto Layout применяется с Phase 7 |
| `justify-content` | ✅ / ⚠️ | 1 | `flex-start/center/flex-end/space-between` — ✅; `space-around`/`space-evenly` — ⚠️ приближено к `start` с diagnostic (нет аналога в Figma Auto Layout) |
| `align-items` | ✅ | 1 | `baseline` только для HORIZONTAL layoutMode (ограничение Figma API) |
| `display: grid` | ⏳ | — | Не реализовано, только "ровные" сетки планируются — ✅, иначе ⚠️ |
| `position: absolute` | ✅ | 3 | Phase 8, дети Auto Layout через `layoutPositioning:'ABSOLUTE'`; родитель без Auto Layout — тоже явные координаты (fallback с diagnostic `block-layout-approximated`) |
| Nested flex (несколько уровней) | ✅ | 4 | Phase 8, рекурсивный обход через CDP + `convertElement` |
| `::before` / `::after` | ✅ | 5 | Phase 8, материализуются как обычные дочерние узлы через `pseudoElements`/`backendNodeId`, без JS-инъекции |
| `transform: matrix()`/`matrix3d()` | ⚠️ (по дизайну) | 6 | Не применяется, только diagnostic `transform-not-applied` — осознанный fallback, не баг |
| `transform: translate/rotate/scale` (простые) | ⏳ | — | Не реализовано |
| `<img>` / raster | ✅ | 7 | Phase 9 (asset-engine) — `fetch()` из main-процесса, hash-дедуп, `figma.createImage` |
| `srcset` (выбор варианта) | ⏳ | — | Не реализовано, берётся только `src` |
| inline `<svg>` / `.svg` | ✅ | 8 | Phase 9, сохраняется как vector через `figma.createNodeFromSvg`, не растрируется |
| Повторяющиеся `<svg>`-иконки (dedup) | ✅ | 9 | Phase 9, ключ дедупликации — sha256 hash нормализованного содержимого, см. asset-model.md |
| `background-image` | ⏳ | — | Не реализовано |
| `box-shadow` | ✅ | — | Phase 5, множественные/inset тени тоже (см. `shadow.ts`) |
| `border-radius` (в т.ч. по углам) | ✅ | — | Phase 5 |
| `font-family`/`font-size`/`font-weight`/`line-height` | ✅ | — | Phase 5; недоступные в Figma шрифты → warning + configurable fallback (п.21 ТЗ) — ещё не реализовано, нужен реальный `<text>`-узел (Phase 8) |
| `overflow: hidden` | ⏳ | — | `clipsContent`, ещё не реализовано |
| `canvas`/WebGL контент | ⏳ → raster snapshot (по дизайну) | — | Phase 9, обязательный warning |
| CSS `calc()` | ✅ (по дизайну, "бесплатно") | — | Всегда читаем computed-значение через CDP, calc() никогда не долетает до engine |
| CSS переменные (`var()`) | ✅ (по дизайну, "бесплатно") | — | Аналогично — резолвятся браузером до снятия снапшота |

Таблица обновляется в том же PR, где меняется соответствующая часть
`conversion-engine` — не отдельным "потом задокументирую" шагом.
