import { useEffect, useRef, type ReactNode } from 'react'

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

/** Плавающий попап у кнопки-якоря (не modal) — портировано из .settings-popup Skill-tree. */
export function Popover({ open, onClose, anchor, children, placement = 'down' }: PopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
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

  const placementClass = placement === 'up-stretch' ? ' popover-up-stretch' : placement === 'up' ? ' popover-up' : ''

  return (
    <div className="popover-anchor" ref={ref}>
      {anchor}
      {open && <div className={`popover${placementClass}`}>{children}</div>}
    </div>
  )
}
