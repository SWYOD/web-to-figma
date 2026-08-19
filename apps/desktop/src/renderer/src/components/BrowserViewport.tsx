import { useEffect, useRef } from 'react'

/**
 * "Дырка" в layout, куда main-процесс кладёт нативный WebContentsView
 * (см. apps/desktop/src/main/browser.ts). Сам div ничего не рисует — он
 * только источник координат: WebContentsView.setBounds() ожидает те же
 * единицы, что и getBoundingClientRect() в renderer (DIP окна), так что
 * бэкенду достаточно просто транслировать прямоугольник этого div'а.
 */
export function BrowserViewport(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const sendBounds = (): void => {
      const rect = el.getBoundingClientRect()
      window.api.browserSetBounds({
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
  }, [])

  return <div ref={ref} className="browser-viewport" />
}
