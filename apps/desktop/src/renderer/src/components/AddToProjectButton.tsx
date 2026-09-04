import { useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import { CreateProjectModal } from './CreateProjectModal'
import { usePopoverVisibility } from '../hooks/usePopoverVisibility'

interface Props {
  site: { url: string; title: string; faviconUrl: string | null }
  /** Стартовая страница/пустой url — кнопка блокируется, добавлять нечего. */
  disabled?: boolean
}

/**
 * Кнопка "Добавить в проект" в тулбаре браузера — сам попап (список
 * проектов) больше НЕ рендерится здесь локальным `<Popover>`. Он живёт в
 * отдельном overlay-слое ('popover', см. main/overlay.ts/
 * PopoverOverlayRoot.tsx/AddToProjectPopoverContent.tsx) — реально НАД
 * встроенным браузером, без прятанья его через usePopoverVisibility (живой
 * баг, поймал пользователь: попап оказывался позади браузера, потому что
 * кнопка сидит прямо над browser-pane). Эта кнопка только: (1) считает свой
 * anchor и просит main открыть/закрыть popover-слой, (2) слушает, не
 * закрылся ли попап "снаружи" (клик в страницу браузера/Esc), чтобы
 * синхронизировать active-подсветку, (3) обрабатывает единственное
 * действие, которое сам попап сделать не может — открыть CreateProjectModal
 * (см. AddToProjectPopoverContent.tsx докстринг).
 */
export function AddToProjectButton({ site, disabled }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // CreateProjectModal — обычная HTML-модалка ГЛАВНОГО окна (не overlay-слой),
  // той же usePopoverVisibility-логике, что и другие модалки, всё ещё нужно
  // прятать браузер на время её показа.
  usePopoverVisibility(creating)

  useEffect(() => window.api.onPopoverClosed(() => setOpen(false)), [])

  useEffect(
    () =>
      window.api.onPopoverAction((action) => {
        if (action.type !== 'add-to-project:create-project') return
        void window.api.overlayClosePopover()
        setOpen(false)
        setCreating(true)
      }),
    []
  )

  const toggle = (): void => {
    if (open) {
      void window.api.overlayClosePopover()
      setOpen(false)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    void window.api.overlayOpenPopover({
      anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      kind: 'add-to-project',
      props: { site }
    })
    setOpen(true)
  }

  return (
    <>
      <IconButton ref={btnRef} active={open} disabled={disabled} onClick={toggle} title="Добавить в проект">
        <Bookmark size={14} />
      </IconButton>
      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            setCreating(false)
            const project = await window.api.projectsCreate(input)
            window.api.projectsAddSite(project.id, site, 'site')
          }}
        />
      )}
    </>
  )
}
