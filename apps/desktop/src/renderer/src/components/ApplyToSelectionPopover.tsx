import { useEffect, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'

const KIND = 'apply-to-selection'
// Ширина фиксирована (совпадает с `.popover { min-width:260px }` — попап и
// раньше не растягивался шире), а вот ВЫСОТУ overlay сам измеряет и шлёт
// обратно (см. OverlayRoot.tsx / overlay:report-size) — заранее неизвестна,
// зависит от контента (есть выбор/нет, есть результат применения/нет).
const WIDTH = 300

/**
 * Иконка-якорь в PickerFloatBar. Само содержимое попапа (`ApplyToSelectionContent`)
 * больше НЕ рендерится здесь — оно в отдельном overlay-рендерере поверх
 * встроенного браузера (см. main/overlay.ts, OverlayRoot.tsx), чтобы попап
 * был визуально НАД браузером без hide/inset-компромиссов, которые не устроили
 * пользователя. Этот компонент только: (1) считает координаты, где должен
 * появиться попап (центр попапа = центр всего `.picker-float-bar`, не
 * центр/край иконки — по запросу пользователя; реальную высоту и,
 * соответственно, верх box'а досчитывает main по `overlay:report-size` от
 * самого overlay, см. index.ts `applyOverlayBounds`);
 * (2) шлёт `overlayOpen`/`overlayClose`; (3) знает, открыт ли ИМЕННО ЕГО попап
 * прямо сейчас — через `onOverlayContent` (общий канал, транслируется
 * ОБОИМ рендерерам на любое открытие/закрытие, включая закрытие изнутри
 * overlay по Escape/клику-снаружи — поэтому `open` здесь производный, а не
 * собственный источник правды).
 */
export function ApplyToSelectionPopover(): JSX.Element {
  const [hasSelection, setHasSelection] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offSelection = window.api.onInspectorSelection(() => setHasSelection(true))
    const offOverlay = window.api.onOverlayContent((kind) => setOpen(kind === KIND))
    return () => {
      offSelection()
      offOverlay()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) window.api.overlayClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.overlayClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = (): void => {
    if (open) {
      window.api.overlayClose()
      return
    }
    // Центр ВСЕГО floating-бара, не иконки — иконка сидит с краю бара, а
    // попап должен визуально смотреться центрированным на весь тулбар.
    const toolbar = ref.current!.closest('.picker-float-bar') as HTMLElement | null
    const rect = (toolbar ?? ref.current!).getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    window.api.overlayOpen({
      kind: KIND,
      x: Math.max(8, Math.round(centerX - WIDTH / 2)),
      width: WIDTH,
      anchorTop: rect.top
    })
  }

  return (
    <div ref={ref} className="popover-anchor">
      <IconButton active={open} disabled={!hasSelection} onClick={toggle} title="Apply to Selection">
        <Wand2 size={16} />
      </IconButton>
    </div>
  )
}
