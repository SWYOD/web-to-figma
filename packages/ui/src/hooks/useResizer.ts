import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** Портировано из App.tsx Resizer (Skill-tree, pointer-capture drag) — см. docs/design-system.md §4. */
export function useResizer(onDrag: (deltaX: number) => void): {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: () => void
} {
  const last = useRef<number | null>(null)
  return {
    onPointerDown: (e) => {
      last.current = e.clientX
      ;(e.target as Element).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      if (last.current === null) return
      const dx = e.clientX - last.current
      last.current = e.clientX
      onDrag(dx)
    },
    onPointerUp: () => {
      last.current = null
    }
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
