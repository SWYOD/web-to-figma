/// <reference types="@figma/plugin-typings" />
import type { DesignDocument } from '@web-to-figma/design-ast'
import { placeNearViewport, renderDesignNode } from './renderers/designNode'
import { applyStylesToSelection, type ApplyStylesTargets } from './renderers/applyStyles'
import type { ColorMatchSource } from './renderers/styleMatching'
import { createAssetNode, type PlaceAssetPayload } from './renderers/asset'
import { runDesignAgentCommand } from './designAgentCommands'

/**
 * Main sandbox плагина — максимально тонкий (см. docs/architecture.md §3,
 * "Figma Plugin API изолирован"). Отвечает за:
 *  - показ UI;
 *  - персистентность pairing-токена через figma.clientStorage (сам bridge
 *    WebSocket живёт в UI iframe — sandbox не имеет доступа к сети напрямую
 *    для произвольных WebSocket, только UI-контекст);
 *  - Phase 6: рендер DesignDocument → SceneNode (`renderers/designNode.ts`) —
 *    единственное место в плагине, которое трогает `figma.*` для создания нод;
 *  - Phase 10: применение стилей к уже выделенным нодам (`renderers/applyStyles.ts`),
 *    та же изоляция — единственное место, где Apply to Selection трогает `figma.*`.
 *  - Design Agent bridge (по запросу пользователя, см. `designAgentCommands.ts`):
 *    выполнение команд из ВТОРОГО, независимого канала (тот же брокер на
 *    localhost:3790, что и у DesignAgent — см. `ui/designAgentClient.ts`),
 *    параллельно обычному bridge к desktop-приложению. Позволяет AI работать
 *    с канвасом, пока пользователь параллельно тащит контент вручную через
 *    Web To Figma — Figma не даёт держать два плагина открытыми одновременно,
 *    поэтому канал DesignAgent поднимается ВНУТРИ этого же плагина.
 */

const BRIDGE_TOKEN_KEY = 'bridgeToken'
// По запросу пользователя — 320px не хватало места для трёх бейджей
// подключения в шапке (Web to Figma/AI/Toolkit), последний упирался в край
// окна почти без отступа.
const PLUGIN_WIDTH = 380
const PLUGIN_EXPANDED_HEIGHT = 440
const PLUGIN_COLLAPSED_HEIGHT = 64

figma.showUI(__html__, { width: PLUGIN_WIDTH, height: PLUGIN_EXPANDED_HEIGHT, themeColors: true })

type UiToMainMessage =
  | { type: 'get-stored-token' }
  | { type: 'save-token'; token: string }
  | { type: 'resize-ui'; collapsed: boolean }
  | {
      type: 'import-node'
      requestId: string
      document: DesignDocument
      as: 'frame' | 'component'
      useMatchedTextStyles?: boolean
      useMatchedColorStyles?: boolean
      colorMatchSource?: ColorMatchSource
      placementOffset?: { x: number; y: number }
      alsoCreateInstance?: boolean
    }
  | { type: 'apply-styles'; requestId: string; document: DesignDocument; targets: ApplyStylesTargets }
  | ({ type: 'place-asset'; requestId: string } & PlaceAssetPayload)
  | { type: 'da-command'; id: string; command: string; params: Record<string, unknown> }
  | { type: 'ct-command'; id: string; command: string; params: Record<string, unknown> }

figma.ui.onmessage = async (msg: UiToMainMessage) => {
  if (msg.type === 'resize-ui') {
    figma.ui.resize(PLUGIN_WIDTH, msg.collapsed ? PLUGIN_COLLAPSED_HEIGHT : PLUGIN_EXPANDED_HEIGHT)
    return
  }
  if (msg.type === 'get-stored-token') {
    const token = (await figma.clientStorage.getAsync(BRIDGE_TOKEN_KEY)) as string | undefined
    figma.ui.postMessage({ type: 'stored-token', token: token ?? null })
    return
  }
  if (msg.type === 'save-token') {
    await figma.clientStorage.setAsync(BRIDGE_TOKEN_KEY, msg.token)
    return
  }
  if (msg.type === 'import-node') {
    try {
      const { primary, secondary } = await renderDesignNode(
        msg.document.root,
        msg.document.assets,
        msg.useMatchedTextStyles ?? false,
        msg.useMatchedColorStyles ?? false,
        msg.colorMatchSource ?? 'style',
        msg.as,
        msg.alsoCreateInstance ?? false
      )
      placeNearViewport(primary, msg.placementOffset)
      if (secondary) {
        // Instance рядом с промотированным компонентом (Import as Component
        // + "также создать Instance") — позиционируем ОТНОСИТЕЛЬНО уже
        // размещённого primary (его x/y здесь уже финальные, placeNearViewport
        // выше их выставил), не через viewport заново.
        const GAP = 40
        secondary.x = primary.x + primary.width + GAP
        secondary.y = primary.y
        figma.currentPage.selection = [primary, secondary]
      }
      figma.ui.postMessage({ type: 'import-result', requestId: msg.requestId, ok: true, nodeId: primary.id })
    } catch (err) {
      figma.ui.postMessage({
        type: 'import-result',
        requestId: msg.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return
  }
  if (msg.type === 'place-asset') {
    try {
      const created = createAssetNode(msg)
      placeNearViewport(created)
      figma.ui.postMessage({ type: 'place-asset-result', requestId: msg.requestId, ok: true, nodeId: created.id })
    } catch (err) {
      figma.ui.postMessage({
        type: 'place-asset-result',
        requestId: msg.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return
  }
  if (msg.type === 'apply-styles') {
    try {
      const result = await applyStylesToSelection(msg.document.root, msg.targets)
      figma.ui.postMessage({
        type: 'apply-result',
        requestId: msg.requestId,
        ok: true,
        appliedTo: result.appliedTo,
        skipped: result.skipped
      })
    } catch (err) {
      figma.ui.postMessage({
        type: 'apply-result',
        requestId: msg.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return
  }
  if (msg.type === 'da-command') {
    try {
      const result = await runDesignAgentCommand(msg.command, msg.params)
      figma.ui.postMessage({ type: 'da-result', id: msg.id, ok: true, result })
    } catch (err) {
      figma.ui.postMessage({ type: 'da-result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  if (msg.type === 'ct-command') {
    // Design Toolkit bridge (по запросу пользователя, см. ui/canvasToolkitClient.ts)
    // — ТОТ ЖЕ диспетчер команд, что и у канала DesignAgent выше: полный
    // набор возможностей, а не отдельный урезанный протокол.
    try {
      const result = await runDesignAgentCommand(msg.command, msg.params)
      figma.ui.postMessage({ type: 'ct-result', id: msg.id, ok: true, result })
    } catch (err) {
      figma.ui.postMessage({ type: 'ct-result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
