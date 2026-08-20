import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { nanoid } from 'nanoid'
import { createConsoleLogger } from '@web-to-figma/shared'
import { START_PAGE_URL } from './startPage'
import type { BrowserState, TabsSnapshot } from '../shared/types'

const log = createConsoleLogger('browser')

const START_URL = START_PAGE_URL

/** -3 = ERR_ABORTED — обычная штатная ситуация (редирект/навигация прервана
 *  новой навигацией до завершения предыдущей), не настоящая ошибка загрузки. */
const ERR_ABORTED = -3

interface Tab {
  id: string
  view: WebContentsView
  state: BrowserState
}

/**
 * Управляет встроенным браузером как набором `WebContentsView` (по одному на
 * вкладку), наложенных поверх HTML-слоя окна (см. docs/architecture.md §2 —
 * WebContentsView вместо deprecated BrowserView). Изолировано от IPC/React —
 * apps/desktop/src/main/index.ts только вызывает методы и подписывается на
 * onTabsChange.
 *
 * Важный нюанс платформы: WebContentsView — нативный композитный слой поверх
 * HTML renderer'а окна, а не DOM-элемент. Он всегда рисуется НАД HTML внутри
 * своего bounds-прямоугольника, независимо от z-index в React-дереве. Поэтому
 * bounds обязаны точно соответствовать области-"дырке" в layout (см.
 * BrowserViewport.tsx), и любой UI (popover/modal), которому нужно визуально
 * перекрыть браузер, должен либо не пересекать эту область, либо временно
 * прятать view через `setHidden(true)` (см. ниже) — понадобилось на практике
 * после того, как floating-bar попапы (Import Settings/Apply to Selection) и
 * модалки тем стали визуально залезать в browser area; renderer вызывает это
 * через общий хук `usePopoverVisibility` на каждом popover/модалке.
 *
 * Вкладки: КАЖДАЯ вкладка — отдельный `WebContentsView` со своим состоянием
 * (не одна навигация в общем view) — так сохраняется реальное состояние
 * страницы (scroll/форма/JS) при переключении, а не просто URL. Видна только
 * АКТИВНАЯ вкладка — у остальных нулевые bounds (тот же приём, что и у
 * `setHidden`), реального скрытия WebContents в Electron нет.
 */
export class BrowserController {
  private tabs = new Map<string, Tab>()
  /** Порядок вкладок для UI (Map не гарантирует порядок вставки достаточно явно для reorder в будущем). */
  private order: string[] = []
  private activeTabId: string | null = null
  private lastBounds: Rectangle | null = null
  /** См. класс-docstring — попап/модалка, которая визуально заходит в область
   *  browser-viewport, обязана прятать нативный слой на время своей жизни
   *  (setHidden(true)), иначе он всё равно нарисуется поверх неё. Применяется
   *  к АКТИВНОЙ вкладке — неактивные и так уже невидимы (нулевые bounds). */
  private hidden = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly onTabsChange: (snapshot: TabsSnapshot) => void,
    /** Именно top-level навигация АКТИВНОЙ вкладки (не любой patch стейта), с
     *  URL — используется ElementPicker (Phase 3), чтобы сбрасывать pick-режим
     *  на смене страницы, и RecentSitesStore (index.ts), чтобы записать визит —
     *  сам BrowserController остаётся fs/IPC-агностиком, просто передаёт url колбэком. */
    private readonly onNavigate?: (url: string) => void,
    /** Реальный клик В СТРАНИЦУ переводит OS-фокус на этот webContents —
     *  используется index.ts, чтобы закрывать overlay-попап (см. overlay.ts),
     *  который в главном окне такой клик не увидит (другой webContents). */
    private readonly onFocus?: () => void
  ) {}

  mount(): void {
    this.newTab(START_URL)
  }

  /** Создаёт вкладку и делает её активной (кроме самой первой при mount() —
   *  там активация всё равно единственный возможный исход). */
  newTab(url: string = START_URL): string {
    const id = nanoid()
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    // index 0 — всегда САМЫЙ НИЖНИЙ слой в contentView (z-order = порядок
    // добавления, поздние — выше, см. overlay.ts). Overlay монтируется ОДИН
    // раз при старте окна, сразу после первой вкладки (см. index.ts
    // createWindow) — без явного index любая вкладка, открытая ПОЗЖЕ этого
    // момента (новый таб, target=_blank и т.п.), добавилась бы ПОСЛЕ overlay
    // и перекрыла бы плавающий тулбар (живой баг: тулбар пропадал на второй
    // и любой следующей вкладке). Явный 0 держит все вкладки ниже overlay
    // независимо от порядка их создания.
    this.win.contentView.addChildView(view, 0)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

    const state: BrowserState = {
      url: '',
      title: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      faviconUrl: null,
      loadError: null
    }
    const tab: Tab = { id, view, state }
    this.tabs.set(id, tab)
    this.order.push(id)

    const wc = view.webContents
    wc.on('focus', () => this.onFocus?.())
    wc.on('did-start-loading', () => this.patchTab(id, { isLoading: true, loadError: null }))
    wc.on('did-stop-loading', () =>
      this.patchTab(id, {
        isLoading: false,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
    )
    wc.on('did-navigate', (_e, navUrl) => {
      this.patchTab(id, {
        url: navUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
      if (id === this.activeTabId) this.onNavigate?.(navUrl)
    })
    wc.on('did-navigate-in-page', (_e, navUrl) => this.patchTab(id, { url: navUrl }))
    wc.on('page-title-updated', (_e, title) => this.patchTab(id, { title }))
    wc.on('page-favicon-updated', (_e, favicons) => this.patchTab(id, { faviconUrl: favicons[0] ?? null }))
    wc.on('did-fail-load', (_e, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== ERR_ABORTED) {
        log.warn('did-fail-load', { errorCode, errorDescription })
        this.patchTab(id, { isLoading: false, loadError: errorDescription })
      }
    })
    // Без этого обработчика window.open()/target=_blank/среднюю кнопку мыши
    // по ссылке Electron по умолчанию открывает голым нативным окном ОС, а
    // не новой вкладкой нашего собственного набора WebContentsView (баг,
    // пойманный пользователем на средней кнопке мыши) — перехватываем и
    // заводим настоящую вкладку вместо неё.
    wc.setWindowOpenHandler(({ url }) => {
      this.newTab(url)
      return { action: 'deny' }
    })

    wc.loadURL(normalizeUrlInput(url)).catch((err: Error) => {
      // did-fail-load уже отражает ошибку в state — тут только не даём unhandled rejection.
      log.debug('loadURL rejected', { url, message: err.message })
    })

    this.switchTab(id)
    return id
  }

  /** Закрывает вкладку; если это была активная — переключается на соседнюю
   *  (или создаёт новую стартовую, если закрыли последнюю). */
  closeTab(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const wasActive = id === this.activeTabId
    const idx = this.order.indexOf(id)

    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    this.tabs.delete(id)
    this.order.splice(idx, 1)

    if (this.order.length === 0) {
      this.activeTabId = null
      this.newTab()
      return
    }
    if (wasActive) {
      this.switchTab(this.order[Math.min(idx, this.order.length - 1)]!)
    } else {
      this.emitTabs()
    }
  }

  switchTab(id: string): void {
    if (id === this.activeTabId) return
    const next = this.tabs.get(id)
    if (!next) return

    const prev = this.activeTabId ? this.tabs.get(this.activeTabId) : null
    prev?.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

    this.activeTabId = id
    if (!this.hidden && this.lastBounds) next.view.setBounds(this.lastBounds)
    this.emitTabs()
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getTabsSnapshot(): TabsSnapshot {
    return {
      tabs: this.order.map((id) => ({ id, ...this.tabs.get(id)!.state })),
      activeTabId: this.activeTabId
    }
  }

  setBounds(bounds: Rectangle): void {
    this.lastBounds = bounds
    if (!this.hidden) this.activeView()?.setBounds(bounds)
  }

  /** Прячет/возвращает нативный view нулевыми bounds, НЕ трогая `lastBounds`
   *  (тот продолжает отражать реальную геометрию `.browser-viewport`,
   *  которую renderer шлёт через ResizeObserver независимо от этого флага) —
   *  на `setHidden(false)` view мгновенно возвращается на последние присланные
   *  реальные bounds, а не требует нового `setBounds` от renderer. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    const view = this.activeView()
    if (hidden) view?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    else if (this.lastBounds) view?.setBounds(this.lastBounds)
  }

  /** Bounds последнего setBounds, в системе координат окна (не экрана) —
   *  ElementPicker (hover-тултип) домножает на экранную позицию окна сам. */
  getBounds(): Rectangle | null {
    return this.lastBounds
  }

  /** Размер browser viewport — для DesignDocument.metadata.viewport (Phase 6). */
  getViewportSize(): { width: number; height: number } {
    return { width: this.lastBounds?.width ?? 0, height: this.lastBounds?.height ?? 0 }
  }

  /** Для ElementPicker (Phase 3) — CDP-инспекция идёт по webContents АКТИВНОЙ
   *  вкладки, не по webContents главного окна (там наш React UI, не сайт). */
  getWebContents(): Electron.WebContents | null {
    return this.activeView()?.webContents ?? null
  }

  navigate(input: string): void {
    const view = this.activeView()
    if (!view) return
    const url = normalizeUrlInput(input)
    view.webContents.loadURL(url).catch((err: Error) => {
      log.debug('loadURL rejected', { url, message: err.message })
    })
  }

  back(): void {
    this.activeView()?.webContents.navigationHistory.goBack()
  }

  forward(): void {
    this.activeView()?.webContents.navigationHistory.goForward()
  }

  reload(): void {
    this.activeView()?.webContents.reload()
  }

  stop(): void {
    this.activeView()?.webContents.stop()
  }

  getState(): BrowserState {
    return (this.activeTabId ? this.tabs.get(this.activeTabId)?.state : null) ?? EMPTY_STATE
  }

  private activeView(): WebContentsView | null {
    return (this.activeTabId ? this.tabs.get(this.activeTabId)?.view : null) ?? null
  }

  private patchTab(id: string, next: Partial<BrowserState>): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.state = { ...tab.state, ...next }
    this.emitTabs()
  }

  private emitTabs(): void {
    this.onTabsChange(this.getTabsSnapshot())
  }
}

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  faviconUrl: null,
  loadError: null
}

/**
 * Ввод адресной строки → реальный URL. Голый домен получает `https://`,
 * `localhost`/IP — `http://` (типичный dev-сценарий), остальное без признаков
 * URL/домена уходит поисковым запросом — как в обычном браузере.
 */
// Не все валидные URL-схемы используют "://" (data:, about:, file: и т.п. —
// без слэшей после двоеточия) — одного /^scheme:\/\// недостаточно, иначе
// "data:text/html,..." ошибочно уходит поисковым запросом ниже по функции.
const NON_SLASH_SCHEMES = /^(data|about|file|blob|javascript):/i

export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || NON_SLASH_SCHEMES.test(trimmed)) return trimmed
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`
  }
  const looksLikeDomain = !trimmed.includes(' ') && /^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)
  if (looksLikeDomain) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
