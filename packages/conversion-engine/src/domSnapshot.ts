/**
 * Входной контракт conversion-engine — простые данные, никаких CDP/Electron
 * типов (см. docs/architecture.md §3, границы зависимостей). Собирается
 * вызывающей стороной (сейчас — apps/desktop/src/main/inspector.ts) из
 * DOM.describeNode/DOM.getBoxModel/CSS.getComputedStyleForNode.
 *
 * `children` сознательно нет — вложенные деревья это Phase 8 ("nested trees"),
 * Phase 5 конвертирует один узел.
 */
export interface DomSnapshotNode {
  tag: string
  id: string | null
  classes: string[]
  /** Сырые computed-style значения как их отдаёт CDP: { "display": "flex", "font-size": "14px", ... }. */
  computedStyle: Record<string, string>
  box: { width: number; height: number }
}
