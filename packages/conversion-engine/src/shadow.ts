import type { Effect } from '@web-to-figma/design-ast'
import { parseColor } from './color.js'
import { parseLength } from './length.js'

// Chrome сериализует computed box-shadow как "[inset ]color offsetX offsetY blur[ spread][ inset]",
// несколько теней через запятую. inset может стоять и до, и после — версии Chromium расходятся.
const SHADOW_RE =
  /^(inset\s+)?(rgba?\([^)]*\))\s+(-?[\d.]+px)\s+(-?[\d.]+px)\s+([\d.]+px)(?:\s+(-?[\d.]+px))?\s*(inset)?$/i

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * "none" → []. Сегменты, не подошедшие под ожидаемую форму сериализации,
 * молча пропускаются — а не роняют конвертацию всего узла (см.
 * docs/conversion-rules.md: warning лучше сломанного импорта).
 */
export function parseBoxShadow(raw: string): Effect[] {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'none') return []

  const effects: Effect[] = []
  for (const segment of splitTopLevelCommas(trimmed)) {
    const match = SHADOW_RE.exec(segment)
    if (!match) continue
    const [, insetBefore, color, offsetX, offsetY, blur, spread, insetAfter] = match
    const inset = Boolean(insetBefore || insetAfter)
    effects.push({
      type: inset ? 'inner-shadow' : 'drop-shadow',
      color: parseColor(color as string),
      offsetX: parseLength(offsetX),
      offsetY: parseLength(offsetY),
      blur: parseLength(blur),
      spread: spread ? parseLength(spread) : undefined
    })
  }
  return effects
}
