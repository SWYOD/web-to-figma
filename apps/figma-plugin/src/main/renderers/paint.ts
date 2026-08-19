/// <reference types="@figma/plugin-typings" />
import type { Paint as AstPaint } from '@web-to-figma/design-ast'

/**
 * AST Paint → Figma Paint. Только `import type` из design-ast — сама схема
 * (и zod) в бандл sandbox-кода не попадает, только стёртые на компиляции типы.
 * `linear-gradient`/`radial-gradient`/`image` conversion-engine пока никогда
 * не производит (Phase 5 — только solid из background-color; градиенты и
 * image paint появятся вместе с background-image/asset-engine, Phase 9) —
 * ветки есть для полноты типа (design-ast.md требует default-ветку на
 * неизвестное), возвращают `null` и молча пропускаются вызывающей стороной.
 */
export function toFigmaPaint(paint: AstPaint): Paint | null {
  switch (paint.type) {
    case 'solid':
      return {
        type: 'SOLID',
        color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
        opacity: paint.color.a
      }
    case 'linear-gradient':
    case 'radial-gradient':
    case 'image':
      return null
  }
}

export function toFigmaPaints(paints: AstPaint[]): Paint[] {
  const result: Paint[] = []
  for (const p of paints) {
    const figmaPaint = toFigmaPaint(p)
    if (figmaPaint) result.push(figmaPaint)
  }
  return result
}
