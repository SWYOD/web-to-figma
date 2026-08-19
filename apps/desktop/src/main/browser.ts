import { WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron'
import { createConsoleLogger } from '@web-to-figma/shared'
import type { BrowserState } from '../shared/types'

const log = createConsoleLogger('browser')

const START_URL = 'https://www.google.com'

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
 * BrowserViewport.tsx), и любой будущий UI (popover/tooltip), которому нужно
 * визуально перекрыть браузер, должен либо не пересекать эту область, либо
 * временно прятать view (`setBounds` в нулевой прямоугольник) — в Phase 2 это
 * не требуется, т.к. текущие popover'ы геометрически не заходят в browser area.
 */
export class BrowserController {
  private view: WebContentsView | null = null
  private lastBounds: Rectangle | null = null
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
    /** Именно top-level навигация (не любой patch стейта) — используется
     *  ElementPicker (Phase 3), чтобы сбрасывать pick-режим на смене страницы. */
    private readonly onNavigate?: () => void
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
      this.onNavigate?.()
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
    this.view?.setBounds(bounds)
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
export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`
  }
  const looksLikeDomain = !trimmed.includes(' ') && /^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)
  if (looksLikeDomain) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
