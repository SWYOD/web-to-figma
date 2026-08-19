import type { WebContents } from 'electron'
// import { screen, type Rectangle } from 'electron' // нужно для кастомного hover-тултипа ниже
import { createConsoleLogger } from '@web-to-figma/shared'
import { convertElement } from '@web-to-figma/conversion-engine'
import type { ConversionWarning, DesignAsset, DesignDocument, DesignNode } from '@web-to-figma/design-ast'
import { buildSnapshotTree } from './domSnapshot'
import { parseAppearance, parseLayout, parseTypography, toComputedStyleMap } from './computedStyle'
// Кастомный hover-тултип (тема + Accessibility-секция) — временно отключён
// по запросу пользователя в пользу стокового тултипа Chrome DevTools
// (HIGHLIGHT_CONFIG.showInfo: true ниже). Код не удалён, а закомментирован —
// см. закомментированные блоки в этом файле и hoverTooltip.ts (сам файл
// оставлен нетронутым). Чтобы включить обратно: раскомментировать импорт
// ниже и все блоки, помеченные "ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА", и выставить
// showInfo: false.
// import {
//   buildHoverTooltipInstallScript,
//   buildTooltipLabel,
//   buildTooltipShowScript,
//   HOVER_TOOLTIP_CLEANUP_SCRIPT,
//   HOVER_TOOLTIP_HIDE_SCRIPT,
//   type TooltipAccessibilityInfo,
//   type TooltipMode
// } from './hoverTooltip'
import type { ElementSummary, PickState, SelectionResult } from '../shared/types'

const log = createConsoleLogger('inspector')

// Debugger.attach() принимает конкретную версию протокола — фиксируем, а не
// оставляем "latest", чтобы поведение не менялось молча между версиями Chromium.
const CDP_PROTOCOL_VERSION = '1.3'

// // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — опрос позиции курсора (50мс), см. hoverTooltip.ts.
// const HOVER_POLL_MS = 50

interface InspectNodeRequestedParams {
  backendNodeId: number
}

// // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — типы ответов CDP, нужных только для тултипа.
// interface DomNodeDescription {
//   nodeName: string
//   attributes?: string[]
// }
//
// interface GetNodeForLocationResult {
//   backendNodeId: number
// }
//
// interface BoxModelResult {
//   // border — quad из 8 чисел (x1,y1..x4,y4, по часовой стрелке от top-left),
//   // viewport-relative CSS px — то же, что использует Overlay для рамки.
//   model: { width: number; height: number; border: number[] }
// }
//
// interface AXValue {
//   value?: unknown
// }
//
// interface AXProperty {
//   name: string
//   value: AXValue
// }
//
// interface AXNode {
//   ignored: boolean
//   name?: AXValue
//   role?: AXValue
//   properties?: AXProperty[]
// }
//
// interface GetPartialAXTreeResult {
//   nodes: AXNode[]
// }

/**
 * Оттенки акцента приложения поверх формы подсветки Chrome DevTools (content/
 * padding/border/margin) — тот же native `Overlay.setInspectMode`, что и в
 * самом DevTools: hover-подсветка и info-тултип (tag/id/class/размеры)
 * рисуются Chromium'ом внутри рендерера страницы, а не нашим HTML —
 * тем самым не задевает ограничение из docs/architecture.md §6.8
 * (WebContentsView всегда поверх нашего UI).
 */
const HIGHLIGHT_CONFIG = {
  // Стоковый info-тултип DevTools (см. комментарий вверху файла про кастомный
  // вариант, временно отключённый).
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
  private lastAssets: Record<string, DesignAsset> = {}
  // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
  // private hoverTimer: ReturnType<typeof setInterval> | null = null
  // private hoverBackendNodeId: number | null = null
  // private tooltipMode: TooltipMode = 'dark'

  constructor(
    private readonly getWebContents: () => WebContents | null,
    private readonly onSelect: (result: SelectionResult) => void,
    private readonly onStateChange: (state: PickState) => void
    // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — 4-й и 5-й параметры конструктора:
    // , private readonly getEffectiveTheme: () => Promise<TooltipMode>
    // /** Экранные координаты (не window-relative) прямоугольника WebContentsView
    //  *  браузера — нужны, чтобы сопоставить screen.getCursorScreenPoint() с
    //  *  координатами страницы для DOM.getNodeForLocation (см. hoverTooltip.ts). */
    // , private readonly getViewScreenBounds: () => Rectangle | null
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
      assets: this.lastAssets,
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
      // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
      // await dbg.sendCommand('Accessibility.enable')
      await dbg.sendCommand('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: HIGHLIGHT_CONFIG })
      // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
      // this.tooltipMode = await this.getEffectiveTheme()
      // await dbg.sendCommand('Runtime.evaluate', { expression: buildHoverTooltipInstallScript(this.tooltipMode) })
    } catch (err) {
      log.warn('failed to start pick mode', { message: (err as Error).message })
      this.cleanupDebugger(wc)
      this.onStateChange({ active: false, error: 'Не удалось включить инспектор (возможно, открыты DevTools страницы)' })
      return
    }

    this.active = true
    // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
    // this.hoverBackendNodeId = null
    // this.hoverTimer = setInterval(() => void this.pollHover(dbg), HOVER_POLL_MS)
    this.onStateChange({ active: true, error: null })
  }

  async stop(): Promise<void> {
    if (!this.active) return
    // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
    // if (this.hoverTimer) {
    //   clearInterval(this.hoverTimer)
    //   this.hoverTimer = null
    // }
    // this.hoverBackendNodeId = null
    const wc = this.getWebContents()
    if (wc?.debugger.isAttached()) {
      try {
        await wc.debugger.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} })
        // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
        // await wc.debugger.sendCommand('Runtime.evaluate', { expression: HOVER_TOOLTIP_CLEANUP_SCRIPT })
      } catch (err) {
        log.debug('stop cleanup failed', { message: (err as Error).message })
      }
      this.cleanupDebugger(wc)
    }
    this.active = false
    this.onStateChange({ active: false, error: null })
  }

  // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — весь блок ниже (pollHover/describeForTooltip/safeEval):
  //
  // /**
  //  * Опрашивает screen.getCursorScreenPoint() и сопоставляет с прямоугольником
  //  * WebContentsView, чтобы получить курсор в системе координат страницы
  //  * (CSS px) без единого mousemove-события — см. hoverTooltip.ts, почему
  //  * мы не можем полагаться на JS-листенер внутри страницы, пока активен
  //  * Overlay.setInspectMode.
  //  */
  // private async pollHover(dbg: WebContents['debugger']): Promise<void> {
  //   if (!this.active || !dbg.isAttached()) return
  //   const viewBounds = this.getViewScreenBounds()
  //   if (!viewBounds) return
  //
  //   const cursor = screen.getCursorScreenPoint()
  //   const x = cursor.x - viewBounds.x
  //   const y = cursor.y - viewBounds.y
  //
  //   if (x < 0 || y < 0 || x >= viewBounds.width || y >= viewBounds.height) {
  //     if (this.hoverBackendNodeId !== null) {
  //       this.hoverBackendNodeId = null
  //       await this.safeEval(dbg, HOVER_TOOLTIP_HIDE_SCRIPT)
  //     }
  //     return
  //   }
  //
  //   try {
  //     const loc = (await dbg.sendCommand('DOM.getNodeForLocation', {
  //       x,
  //       y,
  //       includeUserAgentShadowDOM: false
  //     })) as GetNodeForLocationResult
  //
  //     // Box анкерит тултип — если узел не сменился, его box (и так уже
  //     // показанный тултип) не нуждается в обновлении на каждый тик.
  //     if (loc.backendNodeId === this.hoverBackendNodeId) return
  //     this.hoverBackendNodeId = loc.backendNodeId
  //
  //     const described = await this.describeForTooltip(dbg, loc.backendNodeId)
  //     if (described) {
  //       await this.safeEval(
  //         dbg,
  //         buildTooltipShowScript(described.label, described.boxLeft, described.boxTop, described.boxWidth, described.boxHeight)
  //       )
  //     }
  //   } catch {
  //     // Курсор над не-элементным узлом/вне документа — не ошибка, просто нечего показывать.
  //   }
  // }
  //
  // private async describeForTooltip(
  //   dbg: WebContents['debugger'],
  //   backendNodeId: number
  // ): Promise<{ label: string; boxLeft: number; boxTop: number; boxWidth: number; boxHeight: number } | null> {
  //   try {
  //     const [{ node }, { model }, ax] = await Promise.all([
  //       dbg.sendCommand('DOM.describeNode', { backendNodeId }) as Promise<{ node: DomNodeDescription }>,
  //       dbg.sendCommand('DOM.getBoxModel', { backendNodeId }) as Promise<BoxModelResult>,
  //       (dbg.sendCommand('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false }) as Promise<GetPartialAXTreeResult>).catch(
  //         () => null
  //       )
  //     ])
  //     const { id, classes } = attributesToIdAndClasses(node.attributes)
  //     // border — quad [x1,y1, x2,y2, x3,y3, x4,y4] по часовой стрелке от top-left.
  //     const border = model.border
  //     const boxLeft = Math.min(border[0] ?? 0, border[2] ?? 0, border[4] ?? 0, border[6] ?? 0)
  //     const boxTop = Math.min(border[1] ?? 0, border[3] ?? 0, border[5] ?? 0, border[7] ?? 0)
  //     const label = buildTooltipLabel(this.tooltipMode, node.nodeName, id, classes, model.width, model.height, extractAccessibility(ax))
  //     return { label, boxLeft, boxTop, boxWidth: model.width, boxHeight: model.height }
  //   } catch {
  //     return null
  //   }
  // }
  //
  // private async safeEval(dbg: WebContents['debugger'], expression: string): Promise<void> {
  //   try {
  //     await dbg.sendCommand('Runtime.evaluate', { expression })
  //   } catch {
  //     // Дебаггер мог отсоединиться между тиками polling'а (навигация/detach) — не критично.
  //   }
  // }

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
      const { tree: snapshot, truncated, assets } = await buildSnapshotTree(wc, params.backendNodeId)
      this.lastAssets = assets
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

// ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — хелперы вне класса:
//
// /** `Accessibility.getPartialAXTree({fetchRelatives:false})` возвращает ровно
//  *  один узел — сам запрошенный. `ignored:true` — узел исключён из AX-дерева
//  *  (декоративный/неинтерактивный контент) — как и нативный DevTools-тултип,
//  *  секцию Accessibility для таких узлов не показываем вовсе. */
// function extractAccessibility(result: GetPartialAXTreeResult | null): TooltipAccessibilityInfo | null {
//   const node = result?.nodes?.[0]
//   if (!node || node.ignored) return null
//   return {
//     name: typeof node.name?.value === 'string' ? node.name.value : null,
//     role: typeof node.role?.value === 'string' ? node.role.value : null,
//     keyboardFocusable: node.properties?.find((p) => p.name === 'focusable')?.value?.value === true
//   }
// }
//
// /** `DOM.describeNode`'s `attributes` — плоский массив [name, value, name, value, ...]. */
// function attributesToIdAndClasses(attributes: string[] | undefined): { id: string | null; classes: string[] } {
//   if (!attributes) return { id: null, classes: [] }
//   let id: string | null = null
//   let classes: string[] = []
//   for (let i = 0; i < attributes.length; i += 2) {
//     if (attributes[i] === 'id') id = attributes[i + 1] ?? null
//     if (attributes[i] === 'class') classes = (attributes[i + 1] ?? '').split(/\s+/).filter(Boolean)
//   }
//   return { id, classes }
// }
