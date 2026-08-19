/// <reference types="@figma/plugin-typings" />
import type { CornerRadius } from '@web-to-figma/design-ast'

type RadiusCapable = { cornerRadius: number | typeof figma.mixed }
type PerCornerCapable = RadiusCapable & {
  topLeftRadius: number
  topRightRadius: number
  bottomRightRadius: number
  bottomLeftRadius: number
}

/**
 * Общая логика для designNode.ts (рендер новых нод) и applyStyles.ts (Apply
 * to Selection, Phase 10) — не дублируем. Принимает широкий `SceneNode`, а не
 * узкий union "нод с cornerRadius": TS не даёт чисто структурно сузить весь
 * `SceneNode` union через `'cornerRadius' in node` на вызывающей стороне —
 * среди ~15 членов union попадаются типы вроде `ConnectorNode` с несовместимой
 * формой того же поля (`number | undefined` вместо `number | symbol`), поэтому
 * проверка и приведение типа — здесь, внутри функции, а не у вызывающих. Если
 * у ноды нет отдельных per-corner полей (не все типы их поддерживают),
 * усредняем — лучше грубое приближение, чем совсем не применить радиус.
 */
export function applyCornerRadius(node: SceneNode, radius: number | CornerRadius | undefined): void {
  if (radius === undefined) return
  if (!('cornerRadius' in node)) return
  const target = node as unknown as RadiusCapable

  if (typeof radius === 'number') {
    target.cornerRadius = radius
    return
  }
  if (isPerCornerCapable(target)) {
    target.topLeftRadius = radius.topLeft
    target.topRightRadius = radius.topRight
    target.bottomRightRadius = radius.bottomRight
    target.bottomLeftRadius = radius.bottomLeft
  } else {
    target.cornerRadius = (radius.topLeft + radius.topRight + radius.bottomRight + radius.bottomLeft) / 4
  }
}

function isPerCornerCapable(node: RadiusCapable): node is PerCornerCapable {
  return 'topLeftRadius' in node
}
