/// <reference types="@figma/plugin-typings" />
import type { ApplyStylesMessage } from '@web-to-figma/bridge-protocol'
import type { DesignNode } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toFigmaEffects } from './effects'
import { applyLayout } from './layout'
import { applyCornerRadius } from './cornerRadius'
import { applyTypography } from './typography'

export type ApplyStylesTargets = ApplyStylesMessage['payload']['targets']

export interface ApplyStylesSummary {
  appliedTo: number
  skipped: string[]
}

/**
 * Apply to Selection (Phase 10) — в отличие от Import as Frame, не создаёт
 * новых нод, а переносит выбранные категории стилей с последнего
 * инспектированного DOM-элемента на уже выделенные в Figma слои. Каждая
 * категория пропускается по отдельности с диагностикой, если тип целевой
 * ноды её не поддерживает (напр. `layout` только для Frame/Component/
 * Instance) — частичное применение лучше, чем падение всей операции из-за
 * одного неподходящего слоя в multi-selection.
 */
export async function applyStylesToSelection(node: DesignNode, targets: ApplyStylesTargets): Promise<ApplyStylesSummary> {
  const selection = figma.currentPage.selection
  if (selection.length === 0) {
    throw new Error('Нет выделения в Figma — выберите хотя бы один слой.')
  }

  const skipped: string[] = []
  for (const target of selection) {
    await applyToNode(target, node, targets, skipped)
  }
  return { appliedTo: selection.length, skipped }
}

async function applyToNode(target: SceneNode, source: DesignNode, targets: ApplyStylesTargets, skipped: string[]): Promise<void> {
  if (targets.dimensions && 'resize' in target) {
    target.resize(Math.max(1, source.size.width), Math.max(1, source.size.height))
  }

  if (targets.fill) {
    if (!source.fills) {
      // Нечего применять — не диагностика, а честный "источник без заливки".
    } else if ('fills' in target) {
      target.fills = toFigmaPaints(source.fills)
    } else {
      skipped.push(`${target.name}: fill не поддерживается этим типом слоя`)
    }
  }

  if (targets.border) {
    if (!source.strokes) {
      // no-op
    } else if ('strokes' in target) {
      target.strokes = toFigmaPaints(source.strokes.paints)
      if ('strokeWeight' in target) target.strokeWeight = source.strokes.weight
    } else {
      skipped.push(`${target.name}: border не поддерживается этим типом слоя`)
    }
  }

  if (targets.radius && source.cornerRadius !== undefined) {
    if ('cornerRadius' in target) {
      applyCornerRadius(target, source.cornerRadius)
    } else {
      skipped.push(`${target.name}: radius не поддерживается этим типом слоя`)
    }
  }

  if (targets.effects && source.effects && source.effects.length > 0) {
    if ('effects' in target) {
      target.effects = toFigmaEffects(source.effects)
    } else {
      skipped.push(`${target.name}: effects не поддерживаются этим типом слоя`)
    }
  }

  if (targets.layout) {
    if (target.type === 'FRAME' || target.type === 'COMPONENT' || target.type === 'INSTANCE') {
      applyLayout(target, source.layout)
    } else if (source.layout && source.layout.mode !== 'none') {
      skipped.push(`${target.name}: Auto Layout поддерживается только для Frame/Component/Instance`)
    }
  }

  if (targets.typography) {
    if (target.type !== 'TEXT') {
      skipped.push(`${target.name}: typography применяется только к текстовым слоям`)
    } else if (!source.typography) {
      skipped.push(`${target.name}: у выбранного DOM-элемента нет данных типографики`)
    } else {
      const reason = await applyTypography(target, source.typography)
      if (reason) skipped.push(reason)
    }
  }
}
