import type { ConversionWarning } from '@web-to-figma/design-ast'

/**
 * Phase 11 ("warnings/confidence score", roadmap.md) — грубая, но честная
 * метрика: 100 минус штраф за каждый diagnostic по его severity. Не
 * научная формула точности — быстрый сигнал "на сколько можно доверять
 * результату с первого взгляда", не открывая список диагностик. `info` почти
 * не штрафует (это обычно осознанные, задокументированные приближения вроде
 * block-layout-approximated, а не потеря данных); `warning` — заметная, но не
 * фатальная потеря (напр. mixed-inline-text-not-captured); `error` пока не
 * производится ни одним источником diagnostics, зарезервирован на будущее.
 */
const PENALTY: Record<ConversionWarning['severity'], number> = {
  info: 2,
  warning: 8,
  error: 20
}

export function computeConfidenceScore(diagnostics: ConversionWarning[]): number {
  const penalty = diagnostics.reduce((sum, d) => sum + (PENALTY[d.severity] ?? 0), 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Пороги подобраны так, чтобы 1-2 info-диагностики (обычный случай для
 *  почти любой реальной страницы) не сталкивали результат из "high". */
export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 80) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}
