/// <reference types="@figma/plugin-typings" />
import type { Effect as AstEffect } from '@web-to-figma/design-ast'

export function toFigmaEffect(effect: AstEffect): Effect {
  switch (effect.type) {
    case 'drop-shadow':
      return {
        type: 'DROP_SHADOW',
        color: effect.color,
        offset: { x: effect.offsetX, y: effect.offsetY },
        radius: effect.blur,
        spread: effect.spread ?? 0,
        visible: true,
        blendMode: 'NORMAL'
      }
    case 'inner-shadow':
      return {
        type: 'INNER_SHADOW',
        color: effect.color,
        offset: { x: effect.offsetX, y: effect.offsetY },
        radius: effect.blur,
        spread: effect.spread ?? 0,
        visible: true,
        blendMode: 'NORMAL'
      }
    case 'layer-blur':
      return { type: 'LAYER_BLUR', blurType: 'NORMAL', radius: effect.radius, visible: true }
    case 'background-blur':
      return { type: 'BACKGROUND_BLUR', blurType: 'NORMAL', radius: effect.radius, visible: true }
  }
}

export function toFigmaEffects(effects: AstEffect[]): Effect[] {
  return effects.map(toFigmaEffect)
}
