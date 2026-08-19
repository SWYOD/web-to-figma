/** Computed-length значения CDP всегда резолвлены в px (см. docs/conversion-rules.md — calc()/% уже посчитаны браузером). */
export function parseLength(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback
  const n = parseFloat(raw)
  return Number.isNaN(n) ? fallback : n
}
