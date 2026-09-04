import { ToolbarButton } from '@web-to-figma/ui'
import type { QueueItemSummary } from '../../../shared/types'

interface Props {
  item: QueueItemSummary
  onAdd: () => void
  onCancel: () => void
  /** "Добавить в референсы?" во время активной сессии сбора (см.
   *  OverlayRoot.tsx referenceSession) вместо дефолтного "в очередь". */
  confirmLabel?: string
}

/**
 * Попап "Добавить/Отменить" после каждого клика пикером в queue-режиме
 * (мульти-выбор, по запросу пользователя) — та же верстка (`.popover`/
 * `.popover-section`), что и ApplyToSelectionContent.tsx, живёт в том же
 * overlay-рендерере (см. OverlayRoot.tsx), т.к. плавающий тулбар не может
 * рисовать HTML поверх встроенного браузера сам по себе (см. докстринг
 * PickerFloatBar.tsx). Полностью управляемый пропсами (не self-contained,
 * в отличие от ApplyToSelectionContent) — item приходит из
 * onInspectorQueuePending, конкретное решение (Add/Cancel) идёт наружу в
 * OverlayRoot, а не хранится тут локально: сам компонент — чистое
 * представление, вся логика (авто-рестарт пика и т.п.) уже в main-процессе
 * (см. ElementPicker.confirmQueueAdd/Cancel).
 */
export function QueueConfirmCard({ item, onAdd, onCancel, confirmLabel }: Props): JSX.Element {
  const label = item.element.id ? `${item.element.tag}#${item.element.id}` : item.element.classes[0] ? `${item.element.tag}.${item.element.classes[0]}` : item.element.tag

  return (
    <div className="popover overlay-popover">
      <div className="popover-section">
        <div className="popover-label">{confirmLabel ?? 'Добавить в очередь?'}</div>
        <div className="queue-confirm-summary" title={label}>
          {label} · {item.element.width}×{item.element.height}
        </div>
        <div className="queue-confirm-actions">
          <ToolbarButton onClick={onCancel}>Отменить</ToolbarButton>
          <ToolbarButton primary onClick={onAdd}>
            Добавить
          </ToolbarButton>
        </div>
      </div>
    </div>
  )
}
