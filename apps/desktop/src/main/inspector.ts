import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'
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
import type { ElementSummary, PickState, QueueItemSummary, SelectionResult } from '../shared/types'

const log = createConsoleLogger('inspector')

// Debugger.attach() принимает конкретную версию протокола — фиксируем, а не
// оставляем "latest", чтобы поведение не менялось молча между версиями Chromium.
const CDP_PROTOCOL_VERSION = '1.3'

// Снапшот берётся при ТЕКУЩЕМ размере встроенного browser pane, который
// часто уже стандартных desktop-брейкпоинтов сайтов (панели/сайдбар отъедают
// ширину) — из-за этого адаптивные сайты (напр. Tailwind `min-width:900px`)
// отдают мобильную/узкую раскладку вместо desktop-flex, который видит
// пользователь в обычном браузере (см. docs/architecture.md, живая проверка
// на ris.pxls-cdn.ru/standardization). `withDesktopViewport` временно
// раздвигает CDP-viewport хотя бы до этого reference-размера через
// Emulation.setDeviceMetricsOverride (реальный layout страницы пересчитывается,
// backendNodeId остаётся валиден — идентичность DOM-узла не зависит от
// раскладки). Никогда не СУЖАЕМ — если реальный viewport и так шире
// (пользователь развернул окно на большом экране), используем его.
//
// ВАЖНО: это ре-раскладка РЕАЛЬНОГО видимого webContents (offscreen-снапшот
// в CDP не сделать) — на видимой странице это выглядит как заметный "дёрг"
// раскладки на время override'а. Раньше это применялось на КАЖДЫЙ клик
// пикера (handleInspectNodeRequested) — пользователь поймал баг ("странно
// дёргается при клике в инспект-режиме"). Теперь применяется ТОЛЬКО один раз,
// прямо перед реальным импортом в Figma (`prepareForImport()`, вызывается из
// index.ts перед `buildDocument()`) — обычный клик для просмотра в Inspector
// Panel снимает снапшот на текущем реальном viewport без какого-либо дёрга,
// как было до этой фичи; "дёрг" остаётся только один раз на committing-действие
// Import as Frame, где это ощутимо более приемлемо, чем на каждом exploratory-клике.
const CAPTURE_MIN_WIDTH = 1440
const CAPTURE_MIN_HEIGHT = 900

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

// `Overlay.setInspectMode('none')`/detach debugger'а (см. stop()) убирают
// CDP-нарисованную hover-подсветку СРАЗУ — визуально "выбор пропадает" сразу
// после клика (реальный баг, поймал пользователь). CDP-оверлеи не переживают
// отсоединение debugger'а в принципе, поэтому "персистентная" подсветка
// выбранного элемента сделана ПРОСТЫМ инлайн-`outline` на самой странице
// (переживает detach), а не через Overlay — помечается атрибутом-маркером
// (не held object reference — тот тоже не переживает detach/повторный
// attach между отдельными кликами пикера).
const PICK_HIGHLIGHT_ATTR = 'data-w2f-picked'
// boxShadow даёт свечение вокруг обводки (по запросу пользователя — "чисто
// визуальный момент, для красоты"): двойная тень — плотная у самого края и
// размытая шире — читается как glow, а не просто более толстая обводка.
// box-shadow не требует места в layout (в отличие от filter:drop-shadow на
// элементе с overflow:hidden — тот обрезался бы), поэтому безопасен на любом
// произвольном узле страницы.
const APPLY_PICK_HIGHLIGHT_FUNCTION = `function() {
  this.setAttribute('${PICK_HIGHLIGHT_ATTR}', JSON.stringify({ outline: this.style.outline, outlineOffset: this.style.outlineOffset, boxShadow: this.style.boxShadow }))
  this.style.outline = '2px solid #8b5cf6'
  this.style.outlineOffset = '-2px'
  this.style.boxShadow = '0 0 0 1px rgba(139, 92, 246, 0.5), 0 0 16px 2px rgba(139, 92, 246, 0.55)'
}`
// Снимает подсветку с ЛЮБОГО ранее помеченного элемента по атрибуту (не по
// held reference) — вызывается в начале каждого нового start(), чтобы старая
// подсветка не оставалась висеть, когда пользователь выбирает следующий элемент.
const CLEAR_PICK_HIGHLIGHT_SCRIPT = `(() => {
  document.querySelectorAll('[${PICK_HIGHLIGHT_ATTR}]').forEach((el) => {
    try {
      const prev = JSON.parse(el.getAttribute('${PICK_HIGHLIGHT_ATTR}') || '{}')
      el.style.outline = prev.outline || ''
      el.style.outlineOffset = prev.outlineOffset || ''
      el.style.boxShadow = prev.boxShadow || ''
    } catch {}
    el.removeAttribute('${PICK_HIGHLIGHT_ATTR}')
  })
})()`

// Живой баг, найденный пользователем: наша ЖЕ подсветка выбранного элемента
// (outline+box-shadow выше) — это ОБЫЧНЫЙ инлайн-стиль на реальной странице,
// поэтому CDP `CSS.getComputedStyleForNode` в `buildSnapshotTree` честно
// видел его как часть computed style элемента и импортировал фиолетовый glow
// как настоящий box-shadow эффект в Figma. Снимается ВРЕМЕННО прямо перед
// снятием снапшота (см. `captureAndConvert`/`withoutPickHighlight` ниже) —
// как обычный клик пикера (highlight только что применён), так и
// `prepareForImport()` (highlight мог провисеть на странице долго, пока
// пользователь решал, импортировать ли) — оба идут через один и тот же
// `captureAndConvert`, поэтому фикс достаточно применить один раз там, а не
// дублировать в обоих вызывающих местах.
const SUPPRESS_PICK_HIGHLIGHT_FUNCTION = `function() {
  try {
    const prev = JSON.parse(this.getAttribute('${PICK_HIGHLIGHT_ATTR}') || '{}')
    this.style.outline = prev.outline || ''
    this.style.outlineOffset = prev.outlineOffset || ''
    this.style.boxShadow = prev.boxShadow || ''
  } catch {}
}`
// Возвращает ровно то же визуальное состояние, что APPLY_PICK_HIGHLIGHT_FUNCTION
// ставит изначально — но БЕЗ повторной записи атрибута (тот уже хранит
// оригинальные pre-highlight значения, перезаписывать их значениями
// SUPPRESS-состояния было бы неверно).
const RESTORE_PICK_HIGHLIGHT_FUNCTION = `function() {
  this.style.outline = '2px solid #8b5cf6'
  this.style.outlineOffset = '-2px'
  this.style.boxShadow = '0 0 0 1px rgba(139, 92, 246, 0.5), 0 0 16px 2px rgba(139, 92, 246, 0.55)'
}`

/** Один захваченный (но ещё не обязательно импортированный) элемент очереди
 *  мульти-импорта — полный `conversion`/`assets` держим здесь же, а не
 *  полагаемся на single-slot `lastConversion`/`lastAssets` (те продолжают
 *  перезаписываться каждым новым пиком, как и раньше). */
interface QueueItem {
  id: string
  result: SelectionResult
  conversion: { node: DesignNode; diagnostics: ConversionWarning[] }
  assets: Record<string, DesignAsset>
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
  /** backendNodeId последнего клика — нужен, чтобы `prepareForImport()` мог
   *  пересобрать `lastConversion` на desktop-ширине перед реальным импортом
   *  (см. комментарий у CAPTURE_MIN_WIDTH выше), не заставляя обычный клик
   *  пикера трогать реальный viewport. */
  private lastBackendNodeId: number | null = null
  /** Последний результат для панели (не только DesignNode-дерево для
   *  импорта) — нужен, чтобы правая панель могла подхватить уже сделанный
   *  выбор при повторном открытии (закрыта в момент клика → пропустила
   *  live-событие onSelect). */
  private lastSelectionResult: SelectionResult | null = null
  /**
   * Queue-mode (мульти-импорт, по запросу пользователя — "поочерёдный выбор
   * с добавлением по одному, потом импорт разом"). Overlay.setInspectMode
   * принципиально single-select — нет способа выбрать сразу несколько узлов
   * за один pick (см. план фичи). Вместо этого: каждый клик пикера при
   * активном queueMode НЕ идёт в обычный `onSelect` (single-selection путь
   * для Import as Frame/Apply to Selection), а откладывается в
   * `pendingQueueItem` и ждёт явного confirmQueueAdd()/Cancel() — тулбар
   * показывает попап "Добавить/Отменить". После Add/Cancel пик-режим сам
   * перезапускается (`start()`), если queueMode всё ещё включён — так
   * реализуется "поочерёдный выбор" без повторных нажатий кнопки пикера.
   */
  private queueMode = false
  private queue: QueueItem[] = []
  private pendingQueueItem: QueueItem | null = null
  // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА:
  // private hoverTimer: ReturnType<typeof setInterval> | null = null
  // private hoverBackendNodeId: number | null = null
  // private tooltipMode: TooltipMode = 'dark'

  constructor(
    private readonly getWebContents: () => WebContents | null,
    private readonly onSelect: (result: SelectionResult) => void,
    private readonly onStateChange: (state: PickState) => void,
    /** Клик пикером при активном queueMode — вместо `onSelect`, ждёт
     *  подтверждения (см. класс-докстринг про queueMode). */
    private readonly onQueuePending: (item: QueueItemSummary) => void,
    /** Очередь изменилась (add/remove/clear/confirm) — драйвит карточки в
     *  левой панели и счётчик на кнопке батч-импорта. */
    private readonly onQueueChange: (items: QueueItemSummary[]) => void
    // ВКЛЮЧИТЬ ДЛЯ КАСТОМНОГО ТУЛТИПА — 6-й и 7-й параметры конструктора:
    // , private readonly getEffectiveTheme: () => Promise<TooltipMode>
    // /** Экранные координаты (не window-relative) прямоугольника WebContentsView
    //  *  браузера — нужны, чтобы сопоставить screen.getCursorScreenPoint() с
    //  *  координатами страницы для DOM.getNodeForLocation (см. hoverTooltip.ts). */
    // , private readonly getViewScreenBounds: () => Rectangle | null
  ) {}

  getLastConversion(): { node: DesignNode; diagnostics: ConversionWarning[] } | null {
    return this.lastConversion
  }

  getLastSelection(): SelectionResult | null {
    return this.lastSelectionResult
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
      // Снимает outline-подсветку с ранее выбранного элемента (см. константы
      // выше) — новый pick начинается "с чистого листа". Не критично, если
      // страница уже ушла/элемент исчез — тихо игнорируем.
      await dbg.sendCommand('Runtime.evaluate', { expression: CLEAR_PICK_HIGHLIGHT_SCRIPT }).catch(() => {})
      await dbg.sendCommand('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: HIGHLIGHT_CONFIG })
      // Esc-отмена читается ЗДЕСЬ, на webContents самой страницы через
      // before-input-event, а не обычным DOM `keydown`-листенером в React —
      // тот сработал бы, только если фокус ОС сейчас именно на renderer'е
      // приложения (тулбар/правая панель), а не на встроенной странице, на
      // которую пользователь наводится курсором в процессе пика (живой баг:
      // "Escape не отменяет пик режим"). before-input-event видит ввод в
      // ЭТОТ webContents независимо от фокуса остальных окон/панелей.
      wc.on('before-input-event', this.handleBeforeInput)
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

  /** Вызывается извне при навигации браузера — старый DOM-снапшот больше не
   *  валиден. `pendingQueueItem` сбрасывается ВСЕГДА (даже если `active`
   *  сейчас false — во время ожидания Добавить/Отменить пик-режим уже не
   *  active, см. класс-докстринг), а не только вместе с `stop()` — иначе
   *  переключение вкладки/навигация в момент открытого попапа подтверждения
   *  оставляла бы его висеть над уже невалидным снапшотом. `queueMode`/
   *  накопленная `queue` не трогаются — пользователь мог намеренно перейти
   *  на другую страницу, чтобы продолжить набирать очередь оттуда. */
  stopIfActive(): void {
    if (this.active) void this.stop()
    this.pendingQueueItem = null
  }

  private cleanupDebugger(wc: WebContents): void {
    wc.debugger.removeListener('message', this.handleMessage)
    wc.debugger.removeListener('detach', this.handleDetach)
    wc.removeListener('before-input-event', this.handleBeforeInput)
    if (wc.debugger.isAttached()) wc.debugger.detach()
  }

  private handleBeforeInput = (_event: unknown, input: Electron.Input): void => {
    if (this.active && input.type === 'keyDown' && input.key === 'Escape') void this.stop()
  }

  private handleMessage = (_event: unknown, method: string, params: unknown): void => {
    if (method !== 'Overlay.inspectNodeRequested') return
    void this.handleInspectNodeRequested(params as InspectNodeRequestedParams)
  }

  private handleDetach = (): void => {
    this.active = false
    this.onStateChange({ active: false, error: null })
  }

  /**
   * Временно раздвигает CDP-viewport страницы до `CAPTURE_MIN_WIDTH`×`CAPTURE_MIN_HEIGHT`
   * (не сужая, если реальный viewport и так шире) на время `fn`, потом снимает
   * override — см. комментарий у констант выше про причину и живую проверку.
   */
  private async withDesktopViewport<T>(dbg: WebContents['debugger'], fn: () => Promise<T>): Promise<T> {
    let overridden = false
    try {
      const metrics = (await dbg.sendCommand('Page.getLayoutMetrics')) as {
        cssVisualViewport?: { clientWidth: number; clientHeight: number }
      }
      const current = metrics.cssVisualViewport
      if (current) {
        const width = Math.max(current.clientWidth, CAPTURE_MIN_WIDTH)
        const height = Math.max(current.clientHeight, CAPTURE_MIN_HEIGHT)
        if (width > current.clientWidth || height > current.clientHeight) {
          await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
            width: Math.round(width),
            height: Math.round(height),
            deviceScaleFactor: 0,
            mobile: false
          })
          overridden = true
          // Даём странице пересчитать layout/media-query-зависимый CSS перед снятием box-модели.
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      return await fn()
    } finally {
      if (overridden) await dbg.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {})
    }
  }

  /** Снимает снапшот backendNodeId на ТЕКУЩЕМ (реальном) viewport и обновляет
   *  lastConversion/lastAssets/lastSelectionResult — общий путь для обычного
   *  клика пикера и для `prepareForImport()` (та лишь оборачивает вызов в
   *  `withDesktopViewport`, см. комментарий у CAPTURE_MIN_WIDTH). */
  private async captureAndConvert(wc: WebContents, backendNodeId: number): Promise<SelectionResult> {
    const { tree: snapshot, truncated, assets } = await this.withoutPickHighlight(wc, backendNodeId, () =>
      buildSnapshotTree(wc, backendNodeId)
    )
    this.lastAssets = assets
    const styleMap = toComputedStyleMap(Object.entries(snapshot.computedStyle).map(([name, value]) => ({ name, value })))

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

    return { element: summary, diagnostics: this.lastConversion.diagnostics }
  }

  /**
   * Живой баг: клик пикером иногда ощутимо "подвисал" перед тем, как элемент
   * визуально выбирался — раньше ЭТА функция целиком ждала
   * `captureAndConvert()` (структура + computed style + authored CSS +
   * СЕТЕВАЯ загрузка байт всех картинок в поддереве, см. domSnapshot.ts) и
   * только потом ставила подсветку/выходила из pick-режима. Быстрая
   * обратная связь по клику (подсветка на странице, выход из inspect-режима,
   * `onStateChange({active:false})` → тулбар гаснет) НЕ должна зависеть от
   * того, сколько там картинок и с какой скоростью отвечает их CDN — она
   * идёт СРАЗУ; тяжёлый захват — уже после, тулбар/подсветка к этому моменту
   * уже отреагировали. debugger при этом ОСТАЁТСЯ подключён до конца захвата
   * (полный detach — в `finally`, а не в `stop()`, которая отсоединила бы
   * его раньше времени и уронила бы саму `captureAndConvert`).
   */
  private async handleInspectNodeRequested(params: InspectNodeRequestedParams): Promise<void> {
    const wc = this.getWebContents()
    if (!wc) return

    this.lastBackendNodeId = params.backendNodeId
    await this.applyPickHighlight(wc, params.backendNodeId)
    try {
      await wc.debugger.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} })
    } catch (err) {
      log.debug('exit inspect mode failed', { message: (err as Error).message })
    }
    this.active = false
    this.onStateChange({ active: false, error: null })

    try {
      const result = await this.captureAndConvert(wc, params.backendNodeId)
      this.lastSelectionResult = result
      if (this.queueMode) {
        // Не onSelect — ждём явного confirmQueueAdd()/confirmQueueCancel()
        // от пользователя (попап "Добавить/Отменить" в тулбаре), см.
        // класс-докстринг про queueMode. lastConversion/lastAssets успели
        // перезаписаться выше в captureAndConvert — копируем СЕЙЧАС, а не
        // полагаемся на них позже (следующий клик их снова перезапишет).
        this.pendingQueueItem = { id: nanoid(), result, conversion: this.lastConversion!, assets: this.lastAssets }
        this.onQueuePending({ id: this.pendingQueueItem.id, element: result.element })
      } else {
        this.onSelect(result)
      }
    } catch (err) {
      log.warn('failed to describe selected node', { message: (err as Error).message })
    } finally {
      this.cleanupDebugger(wc)
    }
  }

  /** Переключение queue-режима с тулбара. Выключение НЕ трогает уже
   *  накопленную `queue` (пользователь может выключить/включить снова, не
   *  теряя добавленное) — только отменяет ЕЩЁ НЕ подтверждённый pending-item
   *  и сбрасывает соответствующий попап в overlay. */
  setQueueMode(active: boolean): void {
    this.queueMode = active
    if (!active) this.pendingQueueItem = null
  }

  isQueueMode(): boolean {
    return this.queueMode
  }

  getQueue(): QueueItemSummary[] {
    return this.queue.map((item) => ({ id: item.id, element: item.result.element }))
  }

  /** "Добавить" в попапе подтверждения — переносит pending-item в очередь и,
   *  если queueMode всё ещё активен, сразу перезапускает pick для следующего
   *  элемента (см. класс-докстринг — это и есть "поочерёдный выбор"). */
  confirmQueueAdd(): void {
    if (!this.pendingQueueItem) return
    this.queue.push(this.pendingQueueItem)
    this.pendingQueueItem = null
    this.onQueueChange(this.getQueue())
    if (this.queueMode) void this.start()
  }

  /** "Отменить" — тот же авто-рестарт пика, просто без добавления в очередь. */
  confirmQueueCancel(): void {
    this.pendingQueueItem = null
    if (this.queueMode) void this.start()
  }

  removeQueueItem(id: string): void {
    this.queue = this.queue.filter((item) => item.id !== id)
    this.onQueueChange(this.getQueue())
  }

  clearQueue(): void {
    this.queue = []
    this.onQueueChange([])
  }

  /** Пакет `DesignDocument` для батч-импорта — тот же формат, что и
   *  buildDocument() для одиночного пика, просто по всей очереди разом. */
  buildQueueDocuments(sourceUrl: string, viewport: { width: number; height: number }): DesignDocument[] {
    return this.queue.map((item) => ({
      version: 1,
      root: item.conversion.node,
      assets: item.assets,
      diagnostics: item.conversion.diagnostics,
      metadata: { sourceUrl, capturedAt: new Date().toISOString(), viewport }
    }))
  }

  /** Ставит персистентный (переживающий detach debugger'а) outline на
   *  выбранный элемент — см. константы APPLY_PICK_HIGHLIGHT_FUNCTION/
   *  CLEAR_PICK_HIGHLIGHT_SCRIPT выше. Не критично, если резолв узла не
   *  удался (напр. страница уже начала уходить) — тихо игнорируем, это
   *  косметика, не должно ронять сам pick. */
  private async applyPickHighlight(wc: WebContents, backendNodeId: number): Promise<void> {
    try {
      const { object } = (await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId })) as {
        object: { objectId?: string }
      }
      if (!object.objectId) return
      await wc.debugger.sendCommand('Runtime.callFunctionOn', {
        functionDeclaration: APPLY_PICK_HIGHLIGHT_FUNCTION,
        objectId: object.objectId
      })
    } catch (err) {
      log.debug('applyPickHighlight failed', { message: (err as Error).message })
    }
  }

  /** Снимает подсветку с backendNodeId на время `fn()` (снятие снапшота
   *  computed style — см. SUPPRESS/RESTORE_PICK_HIGHLIGHT_FUNCTION выше) и
   *  всегда возвращает её обратно в `finally`, даже если `fn()` упал —
   *  иначе постоянная подсветка выбранного элемента могла бы молча пропасть
   *  после неудачного захвата. Резолв узла/недоступность — не критично
   *  (страница могла уже уйти), тихо игнорируем, как и в applyPickHighlight. */
  private async withoutPickHighlight<T>(wc: WebContents, backendNodeId: number, fn: () => Promise<T>): Promise<T> {
    let objectId: string | undefined
    try {
      const { object } = (await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId })) as {
        object: { objectId?: string }
      }
      objectId = object.objectId
      if (objectId) {
        await wc.debugger.sendCommand('Runtime.callFunctionOn', { functionDeclaration: SUPPRESS_PICK_HIGHLIGHT_FUNCTION, objectId })
      }
    } catch (err) {
      log.debug('suppress pick highlight failed', { message: (err as Error).message })
    }
    try {
      return await fn()
    } finally {
      if (objectId) {
        await wc.debugger
          .sendCommand('Runtime.callFunctionOn', { functionDeclaration: RESTORE_PICK_HIGHLIGHT_FUNCTION, objectId })
          .catch((err) => log.debug('restore pick highlight failed', { message: (err as Error).message }))
      }
    }
  }

  /**
   * Перед реальным импортом в Figma — пересобирает lastConversion на
   * desktop-ширине (см. CAPTURE_MIN_WIDTH выше) для УЖЕ выбранного узла, не
   * трогая viewport на обычном клике пикера. Дебаггер к этому моменту уже
   * отсоединён (`stop()` вызывается сразу после каждого клика) — временно
   * подключаем заново сами, минимальный набор доменов (без Overlay — тут не
   * нужен hover/inspect режим, только чтение DOM/CSS).
   */
  async prepareForImport(): Promise<boolean> {
    if (this.lastBackendNodeId === null) return false
    const wc = this.getWebContents()
    if (!wc) return false

    const dbg = wc.debugger
    const alreadyAttached = dbg.isAttached()
    try {
      if (!alreadyAttached) {
        dbg.attach(CDP_PROTOCOL_VERSION)
        await dbg.sendCommand('DOM.enable')
        await dbg.sendCommand('CSS.enable')
      }
      const result = await this.withDesktopViewport(dbg, () => this.captureAndConvert(wc, this.lastBackendNodeId!))
      this.lastSelectionResult = result
      return true
    } catch (err) {
      log.warn('prepareForImport failed', { message: (err as Error).message })
      return false
    } finally {
      if (!alreadyAttached && dbg.isAttached()) dbg.detach()
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
