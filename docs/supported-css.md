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
| `flex-grow`/`align-items:stretch` (в т.ч. дефолт) → `widthSizing`/`heightSizing:'fill'` | ✅ | — | `resolveSizing()` в `convertElement.ts`; `align-self` ребёнка приоритетнее `align-items` родителя; на Figma-стороне применяется только к не-absolute детям реального Auto Layout родителя |
| `width:auto` → `hug` | ⏳ (по дизайну) | — | Нужен authored CSS (`CSS.getMatchedStylesForNode`), не только computed-style — не реализовано, не спутано с `fixed` |
| `display: grid` | ⏳ | — | Не реализовано, только "ровные" сетки планируются — ✅, иначе ⚠️ |
| `position: absolute` | ✅ | 3 | Phase 8, дети Auto Layout через `layoutPositioning:'ABSOLUTE'`; родитель без Auto Layout — тоже явные координаты (fallback с diagnostic `block-layout-approximated`) |
| Nested flex (несколько уровней) | ✅ | 4 | Phase 8, рекурсивный обход через CDP + `convertElement` |
| `::before` / `::after` | ✅ | 5 | Phase 8, материализуются как обычные дочерние узлы через `pseudoElements`/`backendNodeId`, без JS-инъекции |
| `transform: matrix()`/`matrix3d()` | ⚠️ (по дизайну) | 6 | Не применяется, только diagnostic `transform-not-applied` — осознанный fallback, не баг |
| `transform: translate()` (чистый, `position:absolute`) | ✅ | — | См. отдельную строку ниже — уже покрыто box-моделью, не отдельная материализация |
| `transform: translate()` не на absolute-узле / `rotate/scale/skew` (любой) | ⏳ | — | Не реализовано, diagnostic `transform-not-applied` честно предупреждает |
| `<img>` / raster | ✅ | 7 | Phase 9 (asset-engine) — `fetch()` из main-процесса, hash-дедуп, `figma.createImage` |
| `srcset` (выбор варианта) | ⏳ | — | Не реализовано, берётся только `src` |
| inline `<svg>` / `.svg` | ✅ | 8 | Phase 9, сохраняется как vector через `figma.createNodeFromSvg`, не растрируется |
| Повторяющиеся `<svg>`-иконки (dedup) | ✅ | 9 | Phase 9, ключ дедупликации — sha256 hash нормализованного содержимого, см. asset-model.md |
| `background-image` | ⏳ | — | Не реализовано |
| `box-shadow` | ✅ | — | Phase 5, множественные/inset тени тоже (см. `shadow.ts`) |
| `border-radius` (в т.ч. по углам) | ✅ | — | Phase 5 |
| `font-family`/`font-size`/`font-weight`/`line-height` | ✅ | — | Phase 5 (значения) + текстовый узел (см. ниже) — подбор начертания под installed-в-Figma шрифты эвристический (по имени стиля от font-weight), не "нашёл точное совпадение" — фолбэк Inter Regular, если `loadFontAsync` не находит шрифт; конфигурируемый пользователем font-mapping (п.21 ТЗ) всё ещё не реализован |
| Реальный текст (`type:'text'`, не пустой frame) | ✅ | — | Чистый текстовый лист (все прямые дети — DOM-текстовые узлы) → `figma.createText()` с содержимым; `fills` — CSS `color`, не `background-color` (см. design-ast.md) |
| Смешанный inline-контент (текст + вложенные теги, напр. `<p>x <b>y</b> z</p>`) | ✅ (только "чисто инлайновые" теги) | — | Разворачивается в один текстовый узел со стилизованными диапазонами (`DesignNode.textRuns`), если ВСЕ вложенные элементы — инлайновые теги форматирования (`B/STRONG/I/EM/U/S/STRIKE/SPAN/A/SMALL/MARK/SUB/SUP/CODE/ABBR/CITE/Q/TIME/LABEL`, `BR`); иначе (картинка/блочный элемент среди вложенных) — откат: вложенные элементы конвертируются сами по себе, "голый" текст вокруг них теряется с diagnostic `mixed-inline-text-not-captured` |
| `overflow`/`overflow-x`/`overflow-y` | ✅ | — | `hidden`/`clip`/`scroll`/`auto` на любой оси → `frame.clipsContent = true`; `visible` (браузерный дефолт) → `false`, всегда выставляется явно, не полагаемся на дефолт Figma API |
| `transform: translate()` (чистый, без rotate/scale/skew) на `position:absolute`-узле | ✅ | — | Позиция уже включает смещение через `DOM.getBoxModel` (проверено вживую) — не нужно применять отдельно, diagnostic `transform-not-applied` для этого случая подавлен как вводящий в заблуждение |
| `canvas`/WebGL контент | ⏳ → raster snapshot (по дизайну) | — | Phase 9, обязательный warning |
| CSS `calc()` | ✅ (по дизайну, "бесплатно") | — | Всегда читаем computed-значение через CDP, calc() никогда не долетает до engine |
| CSS переменные (`var()`) | ✅ (по дизайну, "бесплатно") | — | Аналогично — резолвятся браузером до снятия снапшота |

Таблица обновляется в том же PR, где меняется соответствующая часть
`conversion-engine` — не отдельным "потом задокументирую" шагом.
