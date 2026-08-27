import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** Extra controls rendered in the header, before the implicit close affordance
   *  (the caller usually still renders its own close button among these — this
   *  primitive doesn't render one itself, unlike figma-plugin's local Modal). */
  headerActions?: ReactNode
  children: ReactNode
}

export function Modal({ open, onClose, title, headerActions, children }: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          {headerActions && <div className="modal-head-actions">{headerActions}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}
