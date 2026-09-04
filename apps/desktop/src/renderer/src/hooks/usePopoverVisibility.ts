import { useEffect } from 'react'

let openCount = 0

function syncHidden(): void {
  const hasOpen = openCount > 0
  window.api.browserSetHidden(hasOpen)
  // ВТОРОЙ, независимый нативный слой (см. main/index.ts referenceBrowserController)
  // — активен во время сбора референсов на вкладке "Референсы", живёт
  // отдельно от browserController и НЕ прячется вызовом выше. Модалка,
  // открытая поверх References (напр. AssetLightbox по клику на карточку
  // референс-элемента), иначе оставляла встроенный референс-браузер
  // нарисованным ПОВЕРХ неё — живой баг, поймал пользователь. Дёргать оба
  // безусловно безопасно: реально видим (ненулевые bounds) в любой момент
  // только тот из них, чья вкладка сейчас активна, скрытие второго —
  // no-op.
  window.api.referenceBrowserSetHidden(hasOpen)
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
