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
  /** width/height — border-box; x/y — позиция относительно padding-box родителя (0,0 для корня). */
  box: { width: number; height: number; x: number; y: number }
  children?: DomSnapshotNode[]
  /** Заполнено только для узлов, материализованных из ::before/::after. */
  pseudoType?: 'before' | 'after'
  /**
   * Phase 9 — узел уже опознан и задедуплицирован вызывающей стороной
   * (apps/desktop, через @web-to-figma/asset-engine) как asset: `<img>` →
   * 'raster', inline `<svg>` → 'svg'. conversion-engine сам ассеты не
   * скачивает и не хэширует — только переводит это в `DesignNode.type`.
   */
  asset?: { assetId: string; kind: 'raster' | 'svg' }
}
