import { useState } from 'react'
import { ToolbarButton } from '@web-to-figma/ui'

interface Props {
  label: string
}

/**
 * Содержимое попапа "имя/описание референс-элемента" (настройка
 * referenceNamePromptOnAdd, см. SettingsPopover.tsx) — живёт в
 * popover-overlay-рендерере (см. PopoverOverlayRoot.tsx), открывается вместо
 * мгновенного автокоммита из OverlayRoot.tsx handleQueueAdd. `label` —
 * автоимя (tag#id/tag.class), уже посчитанное вызывающей стороной,
 * подставлено в поле имени как стартовое значение — большинство элементов
 * это имя вполне устроит, пользователь просто добавляет описание.
 *
 * Save/Cancel вызывают reference:items-create-from-pending/
 * inspector:queue-confirm-cancel напрямую — pending queue-item в main всё ещё
 * ждёт решения (OverlayRoot не подтвердил его при открытии этого попапа, см.
 * handleQueueAdd), эти два действия и есть финальное решение.
 */
export function ReferenceNamePopoverContent({ label }: Props): JSX.Element {
  const [name, setName] = useState(label)
  const [description, setDescription] = useState('')

  const save = (): void => {
    void window.api.referenceItemsCreateFromPending(name.trim() || label, description.trim() || undefined)
    void window.api.overlayClosePopover()
  }
  const cancel = (): void => {
    void window.api.inspectorQueueConfirmCancel()
    void window.api.overlayClosePopover()
  }

  return (
    <div className="popover">
      <div className="popover-section">
        <div className="popover-label">Добавить референс-элемент</div>
        <input
          className="reference-item-name-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <textarea
          className="reference-item-description-input"
          value={description}
          placeholder="Описание (необязательно)"
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="queue-confirm-actions">
          <ToolbarButton onClick={cancel}>Отменить</ToolbarButton>
          <ToolbarButton primary onClick={save}>
            Добавить
          </ToolbarButton>
        </div>
      </div>
    </div>
  )
}
