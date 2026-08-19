import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { join } from 'path'

/**
 * Второй `WebContentsView`, добавленный в `win.contentView` ПОСЛЕ browser-пейна
 * (см. `browser.ts`, `index.ts` — порядок `addChildView` определяет z-order,
 * поздние дети рисуются НАД более ранними). Это единственный способ показать
 * HTML-попап реально НАД встроенным браузером без hide/inset-компромиссов
 * (`BrowserController.setHidden`/`useBrowserBottomInset` — оба варианта либо
 * прячут часть браузера, либо весь его, что пользователь явно не хочет для
 * Apply to Selection): здесь браузер вообще не трогается, у попапа свой
 * собственный композитный слой, который просто стоит выше по стеку.
 *
 * Прозрачный фон (`setBackgroundColor('#00000000')`) — иначе WebContentsView
 * рисует сплошной непрозрачный прямоугольник даже там, где реального контента
 * ещё нет (bounds всегда чуть больше самого попапа с запасом под контент).
 *
 * Грузит ТОТ ЖЕ renderer-бандл, что и главное окно, с `?overlay=1` в URL —
 * `main.tsx` ветвится на этом флаге и монтирует `OverlayRoot` вместо `App`
 * (см. renderer). Один переиспользуемый view на всё приложение — какой попап
 * сейчас показан, определяет канал `overlay:content` (renderer→main→сюда).
 */
export class OverlayController {
  private view: WebContentsView | null = null

  mount(win: BrowserWindow, devUrl: string | undefined): void {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.view.setBackgroundColor('#00000000')
    win.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

    if (devUrl) {
      void this.view.webContents.loadURL(`${devUrl}?overlay=1`)
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { search: 'overlay=1' })
    }
  }

  setBounds(bounds: Rectangle): void {
    this.view?.setBounds(bounds)
  }

  hide(): void {
    this.view?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  send(channel: string, payload: unknown): void {
    this.view?.webContents.send(channel, payload)
  }
}
