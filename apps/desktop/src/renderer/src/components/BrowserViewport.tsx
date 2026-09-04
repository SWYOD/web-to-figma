import { useEffect, useRef } from 'react'
import type { ViewBounds } from '../../../shared/types'

interface Props {
  /** Куда слать измеренные bounds — дефолт (главный встроенный браузер)
   *  зовёт browserSetBounds; встроенный референс-браузер (см.
   *  ReferenceBrowserPane.tsx) передаёт referenceBrowserSetBounds вместо
   *  копирования всего файла ради другого IPC-канала. */
  onBounds?: (bounds: ViewBounds) => void
}

/**
 * "Дырка" в layout, куда main-процесс кладёт нативный WebContentsView
 * (см. apps/desktop/src/main/browser.ts). Сам div ничего не рисует — он
 * только источник координат: WebContentsView.setBounds() ожидает те же
 * единицы, что и getBoundingClientRect() в renderer (DIP окна), так что
 * бэкенду достаточно просто транслировать прямоугольник этого div'а.
 */
export function BrowserViewport({ onBounds = (b) => window.api.browserSetBounds(b) }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const sendBounds = (): void => {
      const rect = el.getBoundingClientRect()
      onBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }

    sendBounds()
    const observer = new ResizeObserver(sendBounds)
    observer.observe(el)
    window.addEventListener('resize', sendBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sendBounds)
    }
  }, [onBounds])

  return <div ref={ref} className="browser-viewport" />
}
