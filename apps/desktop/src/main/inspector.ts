import type { WebContents } from 'electron'
import { createConsoleLogger } from '@web-to-figma/shared'
import { convertElement } from '@web-to-figma/conversion-engine'
import type { ConversionWarning, DesignDocument, DesignNode } from '@web-to-figma/design-ast'
import { buildSnapshotTree } from './domSnapshot'
import { parseAppearance, parseLayout, parseTypography, toComputedStyleMap } from './computedStyle'
import type { ElementSummary, PickState, SelectionResult } from '../shared/types'

const log = createConsoleLogger('inspector')

// Debugger.attach() принимает конкретную версию протокола — фиксируем, а не
// оставляем "latest", чтобы поведение не менялось молча между версиями Chromium.
const CDP_PROTOCOL_VERSION = '1.3'

interface InspectNodeRequestedParams {
  backendNodeId: number
}

/**
 * Оттенки акцента приложения поверх формы подсветки Chrome DevTools (content/
 * padding/border/margin) — тот же native `Overlay.setInspectMode`, что и в
 * самом DevTools: hover-подсветка и info-тултип (tag/id/class/размеры)
 * рисуются Chromium'ом внутри рендерера страницы, а не нашим HTML —
 * тем самым не задевает ограничение из docs/architecture.md §6.8
 * (WebContentsView всегда поверх нашего UI).
 */
const HIGHLIGHT_CONFIG = {
  showInfo: true,
  showExtensionLines: true,
  contentColor: { r: 139, g: 92, b: 246, a: 0.2 },
  paddingColor: { r: 155, g: 214, b: 116, a: 0.35 },
  borderColor: { r: 255, g: 204, b: 102, a: 0.5 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.35 }
}

/**
 * Element picker — Phase 3. Изолирован от IPC/React, как и BrowserController.
 * Debugger подключается лениво (только на время активного pick-режима), чтобы
 * не конфликтовать с обычным DevTools пользователя дольше необходимого —
 * Electron разрешает только одного remote-debugging клиента на webContents.
 */
export class ElementPicker {
  private active = false
  private lastConversion: { node: DesignNode; diagnostics: ConversionWarning[] } | null = null

  constructor(
    private readonly getWebContents: () => WebContents | null,
    private readonly onSelect: (result: SelectionResult) => void,
    private readonly onStateChange: (state: PickState) => void
  ) {}

  getLastConversion(): { node: DesignNode; diagnostics: ConversionWarning[] } | null {
    return this.lastConversion
  }

  /** Оборачивает lastConversion в полноценный DesignDocument для отправки через bridge (Phase 6). */
  buildDocument(sourceUrl: string, viewport: { width: number; height: number }): DesignDocument | null {
    if (!this.lastConversion) return null
    return {
      version: 1,
      root: this.lastConversion.node,
      assets: {},
      diagnostics: this.lastConversion.diagnostics,
      metadata: { sourceUrl, capturedAt: new Date().toISOString(), viewport }
    }
  }

  isActive(): boolean {
    return this.active
  }

  async start(): Promise<void> {
    if (this.active) return
    const wc = this.getWebContents()
    if (!wc) {
      this.onStateChange({ active: false, error: 'Сначала откройте страницу в браузере' })
      return
    }

    const dbg = wc.debugger
    try {
      if (!dbg.isAttached()) dbg.attach(CDP_PROTOCOL_VERSION)
      dbg.on('message', this.handleMessage)
      dbg.on('detach', this.handleDetach)
      await dbg.sendCommand('DOM.enable')
      await dbg.sendCommand('CSS.enable')
      await dbg.sendCommand('Overlay.enable')
      await dbg.sendCommand('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: HIGHLIGHT_CONFIG })
    } catch (err) {
      log.warn('failed to start pick mode', { message: (err as Error).message })
      this.cleanupDebugger(wc)
      this.onStateChange({ active: false, error: 'Не удалось включить инспектор (возможно, открыты DevTools страницы)' })
      return
    }

    this.active = true
    this.onStateChange({ active: true, error: null })
  }

  async stop(): Promise<void> {
    if (!this.active) return
    const wc = this.getWebContents()
    if (wc?.debugger.isAttached()) {
      try {
        await wc.debugger.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} })
      } catch (err) {
        log.debug('stop cleanup failed', { message: (err as Error).message })
      }
      this.cleanupDebugger(wc)
    }
    this.active = false
    this.onStateChange({ active: false, error: null })
  }

  /** Вызывается извне при навигации браузера — старый DOM-снапшот больше не валиден. */
  stopIfActive(): void {
    if (this.active) void this.stop()
  }

  private cleanupDebugger(wc: WebContents): void {
    wc.debugger.removeListener('message', this.handleMessage)
    wc.debugger.removeListener('detach', this.handleDetach)
    if (wc.debugger.isAttached()) wc.debugger.detach()
  }

  private handleMessage = (_event: unknown, method: string, params: unknown): void => {
    if (method !== 'Overlay.inspectNodeRequested') return
    void this.handleInspectNodeRequested(params as InspectNodeRequestedParams)
  }

  private handleDetach = (): void => {
    this.active = false
    this.onStateChange({ active: false, error: null })
  }

  private async handleInspectNodeRequested(params: InspectNodeRequestedParams): Promise<void> {
    const wc = this.getWebContents()
    if (!wc) return

    try {
      const { tree: snapshot, truncated } = await buildSnapshotTree(wc, params.backendNodeId)
      const styleMap = toComputedStyleMap(
        Object.entries(snapshot.computedStyle).map(([name, value]) => ({ name, value }))
      )

      const summary: ElementSummary = {
        tag: snapshot.tag,
        id: snapshot.id,
        classes: snapshot.classes,
        width: Math.round(snapshot.box.width),
        height: Math.round(snapshot.box.height),
        layout: parseLayout(styleMap),
        typography: parseTypography(styleMap),
        appearance: parseAppearance(styleMap)
      }

      this.lastConversion = convertElement(snapshot)
      if (truncated) {
        this.lastConversion.diagnostics.push({
          nodeId: this.lastConversion.node.id,
          code: 'subtree-truncated',
          severity: 'warning',
          message: 'Поддерево слишком большое — часть вложенных элементов не импортирована.'
        })
      }

      this.onSelect({ element: summary, diagnostics: this.lastConversion.diagnostics })
    } catch (err) {
      log.warn('failed to describe selected node', { message: (err as Error).message })
    } finally {
      // Клик фиксирует выбор — как в реальном "Inspect element", pick-режим сам выключается.
      await this.stop()
    }
  }
}
