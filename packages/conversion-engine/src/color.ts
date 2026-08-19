import type { Color } from '@web-to-figma/design-ast'

const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i

/**
 * Разбирает computed-color значение. Браузер всегда нормализует computed
 * цвета в `rgb()`/`rgba()` (проверено live на реальной странице, см. Phase 4
 * commit) — никакие hex/named значения на входе не ожидаются.
 */
export function parseColor(raw: string): Color {
  const match = RGB_RE.exec(raw.trim())
  if (!match) return { r: 0, g: 0, b: 0, a: 0 }
  const [, r, g, b, a] = match
  return {
    r: clamp01(Number(r) / 255),
    g: clamp01(Number(g) / 255),
    b: clamp01(Number(b) / 255),
    a: a === undefined ? 1 : clamp01(Number(a))
  }
}

export function isTransparent(color: Color): boolean {
  return color.a === 0
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}
