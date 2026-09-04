import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  open: boolean
  onClose: () => void
  anchor: ReactNode
  children: ReactNode
  /** 'down' (по умолчанию) — попап раскрывается вниз-вправо от якоря (bridge/menu
   *  в toolbar). 'up' — раскрывается вверх, вправо от якоря, естественная ширина
   *  (для кнопок в нижнем floating-баре над браузером — вниз раскрываться некуда,
   *  но, в отличие от 'up-stretch', якорь не на всю ширину узкой колонки). 'up-stretch'
   *  — раскрывается вверх и растягивается на всю ширину родителя якоря (портировано
   *  из .settings-popup Skill-tree — кнопка "Настройки" пришпилена к низу сайдбара). */
  placement?: 'down' | 'up' | 'up-stretch'
}

interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
}

/**
 * Плавающий попап у кнопки-якоря (не modal) — портировано из .settings-popup
 * Skill-tree. Сам попап рендерится порталом в document.body с `position:fixed`,
 * а не как обычный `position:absolute` внутри якоря — живой баг, поймал
 * пользователь: попап меню проекта обрезался скролл-контейнером сайдбара
 * (`.recent-scroll` clip), а попап в BrowserToolbar оказывался НИЖЕ нативного
 * WebContentsView браузера (тот всегда поверх HTML, см. usePopoverVisibility
 * докстринг) — оба класса багов у "прибитого" к якорю absolute-попапа. Портал
 * с фиксированными координатами от `getBoundingClientRect()` якоря устраняет
 * оба: ничем не обрезается и не зависит от overflow предков. z-order с самим
 * WebContentsView браузера по-прежнему решает usePopoverVisibility — этот
 * компонент только про позиционирование, каждый вызывающий должен сам вызвать
 * usePopoverVisibility(open), если попап может визуально пересечь browser-viewport.
 */
export function Popover({ open, onClose, anchor, children, placement = 'down' }: PopoverProps): JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<AnchorRect | null>(null)
  // Popover — content whose height can vary a lot by consumer (a short list
  // vs. e.g. ColorPicker's SV square + two sliders) can overflow the bottom
  // of the window with a fixed 'down' placement. Measured AFTER the popover
  // itself has painted (it needs to exist in the DOM to know its own
  // height), then flips to opening upward if there's more room there —
  // additive to the existing behavior, so callers that already fit below
  // keep opening below exactly as before.
  const [flipUp, setFlipUp] = useState(false)

  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      setFlipUp(false)
      return
    }
    const update = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !rect || placement === 'up' || placement === 'up-stretch') return
    const popoverEl = popoverRef.current
    if (!popoverEl) return
    const height = popoverEl.getBoundingClientRect().height
    const fitsBelow = rect.bottom + 6 + height <= window.innerHeight
    const fitsAbove = rect.top - 6 - height >= 0
    setFlipUp(!fitsBelow && fitsAbove)
  }, [open, rect, placement])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const style = ((): CSSProperties => {
    if (!rect) return { visibility: 'hidden' }
    const rightOffset = window.innerWidth - rect.right
    if (placement === 'up-stretch') {
      return { bottom: window.innerHeight - rect.top + 6, left: rect.left, width: rect.width, minWidth: 0 }
    }
    if (placement === 'up') {
      return { bottom: window.innerHeight - rect.top + 6, right: rightOffset }
    }
    if (flipUp) {
      return { bottom: window.innerHeight - rect.top + 6, right: rightOffset }
    }
    return { top: rect.bottom + 6, right: rightOffset }
  })()

  return (
    <div className="popover-anchor" ref={anchorRef}>
      {anchor}
      {open &&
        createPortal(
          <div className="popover" ref={popoverRef} style={style}>
            {children}
          </div>,
          document.body
        )}
    </div>
  )
}
