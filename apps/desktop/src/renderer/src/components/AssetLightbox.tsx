import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { clamp, IconButton } from '@web-to-figma/ui'
import { usePopoverVisibility } from '../hooks/usePopoverVisibility'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25
// Достаточно, чтобы не считать драгом дрожание руки на обычном клике по
// кнопке зума и т.п. — иначе clientX/Y меняются на 1px даже без намерения тащить.
const DRAG_THRESHOLD = 3

export interface LightboxAsset {
  data: string
  sourceUrl?: string
  mimeType: string
}

interface Props {
  asset: LightboxAsset
  onClose: () => void
}

/**
 * Полноэкранный просмотр ассета по клику на тайл (по запросу пользователя) —
 * тот же `.modal-backdrop`-паттерн, что у ThemesGalleryModal, поэтому
 * `usePopoverVisibility(true)` прячет нативный WebContentsView браузера на
 * время показа (полноэкранная модалка — ожидаемо перекрывает всё, см.
 * docs/architecture.md про разницу между модалками и мелкими попапами).
 *
 * Панорамирование — явный `translate()` в состоянии `pan`, а НЕ
 * `overflow:auto` + `scrollLeft/Top`: у центрированного через
 * `justify-content:center` flex-child'а с `transform:scale()` Chromium не
 * считает выходящую за рамки часть скроллируемым overflow вообще
 * (`scrollWidth === clientWidth` даже при видимом переполнении) — известная
 * особенность overflow-вычисления для центрированных элементов. Ручной
 * `translate() scale()` на самой картинке — надёжный способ в обход этого.
 */
export function AssetLightbox({ asset, onClose }: Props): JSX.Element {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean } | null>(null)
  usePopoverVisibility(true)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const resetView = (): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const onWheel = (e: ReactWheelEvent): void => {
    e.preventDefault()
    setZoom((z) => clamp(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), MIN_ZOOM, MAX_ZOOM))
  }

  // Драг для панорамирования — левой ИЛИ средней кнопкой (по запросу
  // пользователя).
  const onViewportPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, moved: false }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onViewportPointerMove = (e: ReactPointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    drag.moved = true
    setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy })
  }
  const onViewportPointerUp = (e: ReactPointerEvent): void => {
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <span className="lightbox-title" title={asset.sourceUrl ?? asset.mimeType}>
            {asset.sourceUrl ?? asset.mimeType}
          </span>
          <div className="lightbox-actions">
            <IconButton size="xs" title="Уменьшить" onClick={() => setZoom((z) => clamp(z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}>
              <Minus size={14} />
            </IconButton>
            <span className="lightbox-zoom-value">{Math.round(zoom * 100)}%</span>
            <IconButton size="xs" title="Увеличить" onClick={() => setZoom((z) => clamp(z + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}>
              <Plus size={14} />
            </IconButton>
            <IconButton size="xs" title="Сбросить масштаб" onClick={resetView}>
              <RotateCcw size={14} />
            </IconButton>
            <IconButton size="xs" title="Закрыть" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
        <div
          className="lightbox-viewport"
          onWheel={onWheel}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
        >
          <img
            className="lightbox-image"
            src={asset.data}
            alt=""
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          />
        </div>
      </div>
    </div>
  )
}
