import { useEffect } from 'react'

let openCount = 0

function syncHidden(): void {
  window.api.browserSetHidden(openCount > 0)
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
 * становится виден целиком; на закрытии последнего view возвращается.
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
