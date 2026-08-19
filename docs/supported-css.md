# Поддерживаемые CSS-свойства → Figma

Статус: **skeleton**, заполняется по мере реализации `conversion-engine`
(Phase 5-8) и тестовых fixtures (`docs/architecture.md` roadmap). Источник
детальных правил вывода layout — `conversion-rules.md`; здесь — плоская
таблица статусов для быстрой сверки "что уже поддержано".

Статусы: ✅ поддержано · ⚠️ приближение (с warning) · ❌ не поддержано (fallback/skip) · ⏳ запланировано

| CSS свойство | Статус | Fixture | Примечание |
|---|---|---|---|
| `display: flex` (+ direction) | ⏳ | 1 | Phase 7 |
| `gap` / `row-gap` / `column-gap` | ⏳ | 1 | Phase 7 |
| `padding` | ⏳ | 1, 2 | Phase 7 |
| `justify-content` | ⏳ | 1 | `space-around/evenly` — ⚠️ по дизайну, см. conversion-rules.md |
| `align-items` | ⏳ | 1 | Phase 7 |
| `display: grid` | ⏳ | — | Phase 8, только "ровные" сетки — ✅, иначе ⚠️ |
| `position: absolute` | ⏳ | 3 | Phase 8, дети Auto Layout через `layoutPositioning:'ABSOLUTE'` |
| Nested flex (несколько уровней) | ⏳ | 4 | Phase 8 |
| `::before` / `::after` | ⏳ | 5 | Phase 8 |
| `transform: matrix()`/`matrix3d()` | ⏳ → ❌ (по дизайну) | 6 | Осознанный fallback, не баг |
| `transform: translate/rotate/scale` (простые) | ⏳ | — | Phase 8 |
| `<img>` / `srcset` | ⏳ | 7 | Phase 9 (asset-engine) |
| inline `<svg>` / `.svg` | ⏳ | 8 | Phase 9, сохраняется как vector, не растрируется |
| Повторяющиеся `<svg>`-иконки (dedup) | ⏳ | 9 | Phase 9, ключ дедупликации — hash, см. asset-model.md |
| `background-image` | ⏳ | — | Phase 9 |
| `box-shadow` | ⏳ | — | Phase 6 (effects) |
| `border-radius` (в т.ч. по углам) | ⏳ | — | Phase 6 |
| `font-family`/`font-size`/`font-weight`/`line-height` | ⏳ | — | Phase 6; недоступные шрифты → warning + configurable fallback (п.21 ТЗ) |
| `overflow: hidden` | ⏳ | — | Phase 6, `clipsContent` |
| `canvas`/WebGL контент | ⏳ → raster snapshot (по дизайну) | — | Phase 9, обязательный warning |
| CSS `calc()` | ✅ (по дизайну, "бесплатно") | — | Всегда читаем computed-значение через CDP, calc() никогда не долетает до engine |
| CSS переменные (`var()`) | ✅ (по дизайну, "бесплатно") | — | Аналогично — резолвятся браузером до снятия снапшота |

Таблица обновляется в том же PR, где меняется соответствующая часть
`conversion-engine` — не отдельным "потом задокументирую" шагом.
