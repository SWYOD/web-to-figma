import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { join } from 'path'

/**
 * Менеджер НЕЗАВИСИМЫХ overlay-слоёв — каждый свой `WebContentsView`,
 * добавленный в `win.contentView` ПОСЛЕ browser-пейна (порядок addChildView
 * определяет z-order, поздние дети рисуются НАД более ранними, см.
 * browser.ts/index.ts). Это единственный способ показать HTML-попап реально
 * НАД встроенным браузером без hide/inset-компромиссов (`BrowserController.
 * setHidden` либо прячет весь браузер, либо не прячет вовсе): здесь браузер
 * не трогается, у слоя свой собственный композитный слой поверх стека.
 *
 * Изначально был ОДИН такой слой, жёстко под плавающий тулбар пикера
 * (bottom-center). По запросу пользователя обобщён до менеджера: любой новый
 * попап — это ещё один `id` со своим якорем/позиционированием в index.ts, а
 * не переписывание системы заново. Слой `'picker'` (плавающий тулбар,
 * см. index.ts repositionToolbarOverlay) монтируется один раз при старте и
 * живёт всё время работы приложения; остальные слои (напр. `'popover'` —
 * см. repositionPopoverOverlay) монтируются лениво по первому использованию
 * и разворачиваются/прячутся по своим собственным условиям.
 *
 * Прозрачный фон (`setBackgroundColor('#00000000')`) — иначе WebContentsView
 * рисует сплошной непрозрачный прямоугольник даже там, где реального контента
 * ещё нет (bounds всегда чуть больше самого содержимого с запасом).
 *
 * Каждый слой грузит ТОТ ЖЕ renderer-бандл, что и главное окно, с `?overlay=<id>`
 * в URL — `main.tsx` ветвится на этом параметре и монтирует конкретный
 * overlay-компонент (OverlayRoot для 'picker', PopoverOverlayRoot для
 * 'popover' и т.д.) вместо главного `App`.
 */
export class OverlayController {
  private views = new Map<string, WebContentsView>()

  /** Возвращает промис, резолвящийся, когда страница слоя реально загрузилась
   *  и готова принимать IPC (`did-finish-load`) — слои, монтируемые лениво
   *  (не 'picker', см. ниже), отправляют первый `send()` сразу вслед за
   *  `mount()`; без ожидания загрузки это сообщение улетало бы в пустоту
   *  (рендерер ещё не успел бы навесить свой IPC-listener) — живой баг,
   *  поймал пользователь: первое открытие попапа не показывало содержимое
   *  вообще. Уже смонтированный слой резолвится сразу. */
  async mount(id: string, win: BrowserWindow, devUrl: string | undefined): Promise<void> {
    const existing = this.views.get(id)
    if (existing) return
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    view.setBackgroundColor('#00000000')
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    this.views.set(id, view)

    const loaded = new Promise<void>((resolve) => view.webContents.once('did-finish-load', () => resolve()))
    if (devUrl) {
      void view.webContents.loadURL(`${devUrl}?overlay=${id}`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { search: `overlay=${id}` })
    }
    await loaded
  }

  isMounted(id: string): boolean {
    return this.views.has(id)
  }

  setBounds(id: string, bounds: Rectangle): void {
    this.views.get(id)?.setBounds(bounds)
  }

  hide(id: string): void {
    this.views.get(id)?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  send(id: string, channel: string, payload: unknown): void {
    this.views.get(id)?.webContents.send(channel, payload)
  }

  /** Слои, смонтированные лениво (не 'picker'), закрываются насовсем, а не
   *  просто прячутся — по запросу пользователя это редкие ad-hoc попапы,
   *  держать их WebContentsView живым между показами не нужно. */
  unmount(id: string, win: BrowserWindow): void {
    const view = this.views.get(id)
    if (!view) return
    win.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(id)
  }
}
