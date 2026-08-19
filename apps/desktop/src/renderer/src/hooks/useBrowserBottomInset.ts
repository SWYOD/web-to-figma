import { useEffect } from 'react'

const DEFAULT_INSET = '64px'
const POPOVER_OPEN_INSET = '420px'

let openCount = 0

function syncInset(): void {
  document.documentElement.style.setProperty('--browser-bottom-inset', openCount > 0 ? POPOVER_OPEN_INSET : DEFAULT_INSET)
}

/**
 * Для попапов, которые раскрываются ВВЕРХ из нижнего floating-бара
 * (ImportSettingsPopover/ApplyToSelectionPopover) — НЕ прячет весь браузер
 * (см. usePopoverVisibility, это для модалок), а вместо этого раздвигает
 * нижний inset `.browser-viewport` (styles.css) настолько, чтобы попап
 * поместился НАД нативным view, а не был им перекрыт. Работает через уже
 * существующий механизм BrowserViewport.tsx (ResizeObserver на реальный
 * getBoundingClientRect() div'а) — здесь просто меняется CSS-переменная,
 * дальше сам React-компонент подхватывает новый (уменьшенный) rect и шлёт
 * его в main через уже работающий `browserSetBounds`, без отдельного IPC.
 * Остальная часть страницы (всё, что выше попапа) остаётся видимой и
 * интерактивной — в отличие от полного скрытия, которое прятало вообще всё.
 */
export function useBrowserBottomInset(open: boolean): void {
  useEffect(() => {
    if (!open) return
    openCount += 1
    syncInset()
    return () => {
      openCount -= 1
      syncInset()
    }
  }, [open])
}
