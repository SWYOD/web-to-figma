/// <reference types="@figma/plugin-typings" />
import type { DesignDocument } from '@web-to-figma/design-ast'
import { placeNearViewport, renderDesignNode } from './renderers/designNode'
import { applyStylesToSelection, type ApplyStylesTargets } from './renderers/applyStyles'

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
 */

const BRIDGE_TOKEN_KEY = 'bridgeToken'

figma.showUI(__html__, { width: 320, height: 440, themeColors: true })

type UiToMainMessage =
  | { type: 'get-stored-token' }
  | { type: 'save-token'; token: string }
  | { type: 'import-node'; requestId: string; document: DesignDocument; as: 'frame' | 'component' }
  | { type: 'apply-styles'; requestId: string; document: DesignDocument; targets: ApplyStylesTargets }

figma.ui.onmessage = async (msg: UiToMainMessage) => {
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
      const frame = renderDesignNode(msg.document.root, msg.document.assets)
      placeNearViewport(frame)
      figma.ui.postMessage({ type: 'import-result', requestId: msg.requestId, ok: true, nodeId: frame.id })
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
  }
}
