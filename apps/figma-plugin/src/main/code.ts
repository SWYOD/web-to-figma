/// <reference types="@figma/plugin-typings" />

/**
 * Main sandbox плагина — максимально тонкий (см. docs/architecture.md §3,
 * "Figma Plugin API изолирован"). В Phase 1 отвечает только за:
 *  - показ UI;
 *  - персистентность pairing-токена через figma.clientStorage (сам bridge
 *    WebSocket живёт в UI iframe — sandbox не имеет доступа к сети напрямую
 *    для произвольных WebSocket, только UI-контекст).
 * Рендер DesignDocument → SceneNode появится здесь в Phase 6.
 */

const BRIDGE_TOKEN_KEY = 'bridgeToken'

figma.showUI(__html__, { width: 320, height: 440, themeColors: true })

type UiToMainMessage = { type: 'get-stored-token' } | { type: 'save-token'; token: string }

figma.ui.onmessage = async (msg: UiToMainMessage) => {
  if (msg.type === 'get-stored-token') {
    const token = (await figma.clientStorage.getAsync(BRIDGE_TOKEN_KEY)) as string | undefined
    figma.ui.postMessage({ type: 'stored-token', token: token ?? null })
    return
  }
  if (msg.type === 'save-token') {
    await figma.clientStorage.setAsync(BRIDGE_TOKEN_KEY, msg.token)
  }
}
