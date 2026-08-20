/**
 * Входной контракт conversion-engine — простые данные, никаких CDP/Electron
 * типов (см. docs/architecture.md §3, границы зависимостей). Собирается
 * вызывающей стороной (сейчас — apps/desktop/src/main/domSnapshot.ts) из
 * DOM.describeNode/DOM.getBoxModel/CSS.getComputedStyleForNode.
 *
 * `children` (Phase 8) — рекурсивно, реальные DOM-дети + материализованные
 * `::before`/`::after` (`pseudoType`), в порядке before → дети → after.
 */
export interface DomSnapshotNode {
  tag: string
  id: string | null
  classes: string[]
  /** Сырые computed-style значения как их отдаёт CDP: { "display": "flex", "font-size": "14px", ... }. */
  computedStyle: Record<string, string>
  /**
   * true = свойство `width`/`height` реально ЗАДАНО каким-то CSS-правилом
   * автора страницы (или inline `style=`), не только browser-дефолтом —
   * computed style (см. `computedStyle` выше) всегда резолвится в конкретные
   * px и не может отличить "auto → hug по контенту" от "explicit значение,
   * совпавшее по факту с тем же px" (см. resolveSizing в convertElement.ts,
   * это единственный источник сигнала для Figma `HUG` sizing). Заполняется
   * вызывающей стороной через `CSS.getMatchedStylesForNode`. Опционально (не
   * все вызывающие стороны/тесты его собирают) — отсутствие resolveSizing
   * трактует как "неизвестно", тот же 'fixed', что и раньше (безопасный
   * дефолт, не HUG наугад).
   */
  authoredSizing?: { width: boolean; height: boolean }
  /** width/height — border-box; x/y — позиция относительно padding-box родителя (0,0 для корня). */
  box: { width: number; height: number; x: number; y: number }
  children?: DomSnapshotNode[]
  /** Заполнено только для узлов, материализованных из ::before/::after. */
  pseudoType?: 'before' | 'after'
  /**
   * Phase "text nodes" — заполнено, только когда элемент является чистым
   * текстовым листом: все его прямые дети — текстовые узлы DOM (не элементы),
   * содержимое непустое после нормализации пробелов. Наличие этого поля —
   * сигнал conversion-engine создать `type:'text'`, а не `'frame'`. Смешанный
   * контент (текст вперемешку с элементами, напр. `<p>Some <b>x</b> text</p>`)
   * специально НЕ сюда — см. `droppedInlineText`.
   */
  text?: string
  /**
   * Смешанный контент (текст вперемешку с инлайновыми тегами форматирования,
   * напр. `<p>текст <b>жирный</b> ещё текст</p>`) — заполнено ВМЕСТО `text`,
   * когда вызывающая сторона (apps/desktop/src/main/domSnapshot.ts) смогла
   * развернуть поддерево в плоский список стилизованных диапазонов (все
   * вложенные элементы оказались "чисто инлайновыми" тегами форматирования,
   * без картинок/блочных элементов). Сырой computed style на прогон — парсинг
   * в TypographyInfo/Color делает convertElement.ts, как и для обычного узла.
   */
  textRuns?: { text: string; style: Record<string, string> }[]
  /**
   * true — у элемента ЕСТЬ и дочерние элементы, И непустой прямой текст
   * (смешанный контент), но развернуть в textRuns не удалось (среди вложенных
   * элементов встретился не "чисто инлайновый" тег, напр. `<img>`/`<div>`) —
   * текст между/вокруг вложенных тегов молча теряется (рендерятся только сами
   * вложенные элементы), сюда пишется флаг, чтобы conversion-engine мог
   * оставить diagnostic, а не тихо потерять контент без следа.
   */
  droppedInlineText?: boolean
  /**
   * Phase 9 — узел уже опознан и задедуплицирован вызывающей стороной
   * (apps/desktop, через @web-to-figma/asset-engine) как asset: `<img>` →
   * 'raster', inline `<svg>` → 'svg'. conversion-engine сам ассеты не
   * скачивает и не хэширует — только переводит это в `DesignNode.type`.
   */
  asset?: { assetId: string; kind: 'raster' | 'svg' }
}
