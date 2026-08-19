import { WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron'
import { createConsoleLogger } from '@web-to-figma/shared'
import { START_PAGE_URL } from './startPage'
import type { BrowserState } from '../shared/types'

const log = createConsoleLogger('browser')

const START_URL = START_PAGE_URL

/** -3 = ERR_ABORTED — обычная штатная ситуация (редирект/навигация прервана
 *  новой навигацией до завершения предыдущей), не настоящая ошибка загрузки. */
const ERR_ABORTED = -3

/**
 * Управляет встроенным браузером как отдельным `WebContentsView`, наложенным
 * поверх HTML-слоя окна (см. docs/architecture.md §2 — WebContentsView вместо
 * deprecated BrowserView). Изолировано от IPC/React — apps/desktop/src/main/index.ts
 * только вызывает методы и подписывается на onState.
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
 */
export class BrowserController {
  private view: WebContentsView | null = null
  private lastBounds: Rectangle | null = null
  /** См. класс-docstring — попап/модалка, которая визуально заходит в область
   *  browser-viewport, обязана прятать нативный слой на время своей жизни
   *  (setHidden(true)), иначе он всё равно нарисуется поверх неё. */
  private hidden = false
  private state: BrowserState = {
    url: '',
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    loadError: null
  }

  constructor(
    private readonly win: BrowserWindow,
    private readonly onState: (state: BrowserState) => void,
    /** Именно top-level навигация (не любой patch стейта), с URL — используется
     *  ElementPicker (Phase 3), чтобы сбрасывать pick-режим на смене страницы, и
     *  RecentSitesStore (index.ts), чтобы записать визит — сам BrowserController
     *  остаётся fs/IPC-агностиком, просто передаёт url колбэком. */
    private readonly onNavigate?: (url: string) => void
  ) {}

  mount(): void {
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.win.contentView.addChildView(this.view)

    const wc = this.view.webContents
    wc.on('did-start-loading', () => this.patch({ isLoading: true, loadError: null }))
    wc.on('did-stop-loading', () =>
      this.patch({
        isLoading: false,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
    )
    wc.on('did-navigate', (_e, url) => {
      this.patch({
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
      this.onNavigate?.(url)
    })
    wc.on('did-navigate-in-page', (_e, url) => this.patch({ url }))
    wc.on('page-title-updated', (_e, title) => this.patch({ title }))
    wc.on('page-favicon-updated', (_e, favicons) => this.patch({ faviconUrl: favicons[0] ?? null }))
    wc.on('did-fail-load', (_e, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== ERR_ABORTED) {
        log.warn('did-fail-load', { errorCode, errorDescription })
        this.patch({ isLoading: false, loadError: errorDescription })
      }
    })

    this.navigate(START_URL)
  }

  setBounds(bounds: Rectangle): void {
    this.lastBounds = bounds
    if (!this.hidden) this.view?.setBounds(bounds)
  }

  /** Прячет/возвращает нативный view нулевыми bounds, НЕ трогая `lastBounds`
   *  (тот продолжает отражать реальную геометрию `.browser-viewport`,
   *  которую renderer шлёт через ResizeObserver независимо от этого флага) —
   *  на `setHidden(false)` view мгновенно возвращается на последние присланные
   *  реальные bounds, а не требует нового `setBounds` от renderer. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    if (hidden) this.view?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    else if (this.lastBounds) this.view?.setBounds(this.lastBounds)
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

  /** Для ElementPicker (Phase 3) — CDP-инспекция идёт по webContents браузерной
   *  страницы, не по webContents главного окна (там наш React UI, не сайт). */
  getWebContents(): WebContents | null {
    return this.view?.webContents ?? null
  }

  navigate(input: string): void {
    if (!this.view) return
    const url = normalizeUrlInput(input)
    this.view.webContents.loadURL(url).catch((err: Error) => {
      // did-fail-load уже отражает ошибку в state — тут только не даём unhandled rejection.
      log.debug('loadURL rejected', { url, message: err.message })
    })
  }

  back(): void {
    this.view?.webContents.navigationHistory.goBack()
  }

  forward(): void {
    this.view?.webContents.navigationHistory.goForward()
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  stop(): void {
    this.view?.webContents.stop()
  }

  getState(): BrowserState {
    return this.state
  }

  private patch(next: Partial<BrowserState>): void {
    this.state = { ...this.state, ...next }
    this.onState(this.state)
  }
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
