import { useCallback, useRef, useState } from 'react'

const HIDE_DELAY_MS = 200

/**
 * Раскрытие панели по наведению на край в distraction-free режиме (см.
 * App.tsx distractionFree). Небольшая задержка на скрытие — не задержка
 * "распознавания намерения" (как в реальном Vivaldi, где слушается движение
 * мыши по всему окну), а просто анти-flicker: курсор пересекает границу
 * между узкой hover-полоской и самой раскрытой панелью, `onMouseLeave`
 * полоски успевает выстрелить до `onMouseEnter` панели — без задержки
 * панель мигала бы закрытой на стыке. И полоска, и сама панель должны
 * навешивать оба этих хендлера (см. usage), не только полоска.
 *
 * Курсор ЗАВИСИМ от того, что раскрываемая область — обычный HTML, а не
 * нативный WebContentsView браузера (тот перехватывает ввод на уровне ОС,
 * DOM mousemove под ним не приходит вообще) — поэтому реализовано именно
 * как enter/leave на выделенной HTML-полоске у края, а не как глобальный
 * mousemove-трекинг координат по всему окну (тот в принципе не сработал бы
 * над областью браузера).
 */
export function useEdgeReveal(): {
  revealed: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  forceClose: () => void
} {
  const [revealed, setRevealed] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onMouseEnter = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setRevealed(true)
  }, [])

  const onMouseLeave = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setRevealed(false), HIDE_DELAY_MS)
  }, [])

  // Явное закрытие БЕЗ задержки (по запросу пользователя — "сворачивать
  // кликом на верхнюю часть") — клик, в отличие от ухода курсора, это явное
  // намерение свернуть, анти-flicker задержка тут не нужна и только мешала бы.
  const forceClose = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setRevealed(false)
  }, [])

  return { revealed, onMouseEnter, onMouseLeave, forceClose }
}
