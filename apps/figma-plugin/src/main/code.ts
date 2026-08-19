/// <reference types="@figma/plugin-typings" />
import type { DesignDocument } from '@web-to-figma/design-ast'
import { placeNearViewport, renderDesignNode } from './renderers/designNode'

/**
 * Main sandbox плагина — максимально тонкий (см. docs/architecture.md §3,
 * "Figma Plugin API изолирован"). Отвечает за:
 *  - показ UI;
 *  - персистентность pairing-токена через figma.clientStorage (сам bridge
 *    WebSocket живёт в UI iframe — sandbox не имеет доступа к сети напрямую
 *    для произвольных WebSocket, только UI-контекст);
 *  - Phase 6: рендер DesignDocument → SceneNode (`renderers/designNode.ts`) —
 *    единственное место в плагине, которое трогает `figma.*` для создания нод.
 */

const BRIDGE_TOKEN_KEY = 'bridgeToken'

figma.showUI(__html__, { width: 320, height: 440, themeColors: true })

type UiToMainMessage =
  | { type: 'get-stored-token' }
  | { type: 'save-token'; token: string }
  | { type: 'import-node'; requestId: string; document: DesignDocument; as: 'frame' | 'component' }

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
      const frame = renderDesignNode(msg.document.root)
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
  }
}
