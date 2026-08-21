/**
 * Общая эвристика "похож ли CSS-класс на осмысленное имя" — используется и
 * для именования фреймов (convertElement.ts buildName), и для структурной
 * сигнатуры при распознавании компонентов (componentGroups.ts). Отдельный
 * модуль, а не экспорт из convertElement.ts — componentGroups.ts тоже нужен
 * этот хелпер, и обратный импорт создал бы цикл convertElement↔componentGroups.
 */

/** Класс похож на utility-класс (Tailwind/UnoCSS и т.п.), а не на
 *  семантическое имя компонента — такие НЕ годятся в имя фрейма (по запросу
 *  пользователя: "названия по классам", но `<div class="tw:flex tw:gap-2
 *  card-header">` должен назваться "card-header", а не "tw:flex"). Признаки:
 *  variant/arbitrary-value синтаксис (`:`, `[...]`, `tw:`-неймспейс) или
 *  короткий префикс из закрытого списка самых частых utility-групп
 *  (spacing/sizing/flex/grid/position/color и т.п.), за которым сразу идёт
 *  числовое/токенное значение. Эвристика, не парсер CSS-фреймворка —
 *  осознанный компромисс. */
const UTILITY_CLASS_RE =
  /^(?:tw:|hover:|focus:|active:|disabled:|group-|peer-|dark:|sm:|md:|lg:|xl:|2xl:)|[:[\]]|^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|contents|table|relative|absolute|fixed|sticky|static)$|^(?:w|h|min-w|min-h|max-w|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-x|space-y|top|right|bottom|left|inset|z|text|font|leading|tracking|bg|border|rounded|shadow|ring|outline|opacity|cursor|overflow|transition|duration|ease|delay|translate|scale|rotate|col|row|items|justify|content|self|place)-[a-z0-9./%-]+$/i

/** Сгенерированный/хэшированный класс (CSS Modules `Button_root__a1b2c`,
 *  styled-components `sc-bZQynM`, emotion `css-1x2y3z` и т.п.) — тоже не
 *  семантическое имя, отдельно от utility-паттерна выше (другая форма шума,
 *  но общая причина: имя нестабильно между сборками/бесполезно для чтения). */
const HASHED_CLASS_RE = /__[a-z0-9]+$/i

/** Первый класс в списке, похожий на осмысленное имя компонента, а не на
 *  utility/хэш-шум (см. UTILITY_CLASS_RE/HASHED_CLASS_RE). `null`, если
 *  семантического кандидата нет — вызывающая сторона решает сама, чем
 *  заменить (первый класс как есть, тег и т.п.). */
export function pickSemanticClass(classes: string[]): string | null {
  return classes.find((c) => !UTILITY_CLASS_RE.test(c) && !HASHED_CLASS_RE.test(c)) ?? null
}
