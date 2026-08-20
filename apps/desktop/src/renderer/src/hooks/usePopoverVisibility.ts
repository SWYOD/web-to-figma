import { useEffect } from 'react'

let openCount = 0

function syncHidden(): void {
  const hasOpen = openCount > 0
  window.api.browserSetHidden(hasOpen)
  // Overlay-тулбар (второй WebContentsView НАД браузером, см. main/overlay.ts)
  // рисуется поверх ВСЕГО окна, включая эти HTML-модалки — просто спрятать
  // браузер (выше) недостаточно, тулбар продолжал бы плавать НАД самой
  // модалкой (живой баг: полноэкранный просмотрщик ассета перекрывался
  // плавающим тулбаром сверху). См. докстринг у overlaySuppressed в
  // main/index.ts.
  window.api.overlaySetSuppressed(hasOpen)
}

/**
 * Нативный WebContentsView браузера всегда рисуется НАД HTML-слоем окна
 * независимо от z-index (см. main/browser.ts класс-docstring) — любой
 * popover/модалка, которая визуально может зайти в область browser-viewport
 * (floating-bar попапы над браузером, попапы в сайдбаре, модалки тем поверх
 * всего окна), иначе будет обрезана/перекрыта браузером именно в этой части.
 * Вызвать с `open` попапа/модалки — пока открыт хотя бы один такой элемент
 * (общий счётчик, не per-компонент флаг — несколько могут быть открыты
 * одновременно), нативный view прячется нулевыми bounds и HTML-попап
 * становится виден целиком; на закрытии последнего view возвращается. То же
 * самое, тем же счётчиком, применяется и к overlay-тулбару (см. syncHidden).
 */
export function usePopoverVisibility(open: boolean): void {
  useEffect(() => {
    if (!open) return
    openCount += 1
    syncHidden()
    return () => {
      openCount -= 1
      syncHidden()
    }
  }, [open])
}
