import { useEffect, useState } from 'react'
import { Frame as FrameIcon, MousePointerClick, Wand2 } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { PickState } from '../../../shared/types'

const EMPTY_PICK: PickState = { active: false, error: null }

type ImportUiState = { kind: 'idle' | 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

interface Props {
  applyOpen: boolean
  onToggleApply: () => void
  applyDisabled: boolean
}

/**
 * Плавающий пилл-тулбар над браузерной областью (в духе Figma) — единственное
 * место для всех действий над текущим выбором: pick, Import as Frame, Apply
 * to Selection. Живёт постоянно в overlay-рендерере (см. OverlayRoot.tsx,
 * main/overlay.ts) — отдельный composited-слой НАД встроенным браузером,
 * поэтому браузер теперь занимает область целиком (никакой зарезервированной
 * снизу HTML-полосы, как раньше — см. docs/architecture.md, по запросу
 * пользователя). Apply to Selection здесь только КНОПКА-триггер — само
 * состояние "открыт ли popover" и его контент (`ApplyToSelectionContent`)
 * теперь выше, в `OverlayRoot`, т.к. попап должен уметь раздвигать ВЕСЬ
 * overlay вверх (см. `overlay:report-size`), а не будет самостоятельным
 * элементом внутри этого компонента.
 */
export function PickerFloatBar({ applyOpen, onToggleApply, applyDisabled }: Props): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [hasSelection, setHasSelection] = useState(false)
  const [importState, setImportState] = useState<ImportUiState>({ kind: 'idle' })

  useEffect(() => {
    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection(() => {
      setHasSelection(true)
      setImportState({ kind: 'idle' })
    })
    return () => {
      offPick()
      offSelection()
    }
  }, [])

  const togglePick = (): void => {
    if (pick.active) window.api.inspectorStopPick()
    else window.api.inspectorStartPick()
  }

  const handleImport = async (): Promise<void> => {
    setImportState({ kind: 'loading' })
    const settings = await window.api.getSettings()
    const result = await window.api.inspectorImportAsFrame(
      settings.useMatchedTextStyles,
      settings.useMatchedColorStyles,
      settings.colorMatchSource
    )
    setImportState(result.ok ? { kind: 'ok' } : { kind: 'error', message: result.error ?? 'Не удалось импортировать' })
  }

  const label = pick.active
    ? 'Кликните на элемент страницы'
    : importState.kind === 'ok'
      ? 'Frame создан в Figma'
      : importState.kind === 'error'
        ? importState.message
        : null

  return (
    <div className="picker-float-bar">
      <IconButton active={pick.active} onClick={togglePick} title="Select element (Esc — отмена)">
        <MousePointerClick size={16} />
      </IconButton>
      <div className="tb-sep" />
      <IconButton disabled={!hasSelection || importState.kind === 'loading'} onClick={handleImport} title="Import as Frame">
        <FrameIcon size={16} />
      </IconButton>
      <IconButton active={applyOpen} disabled={applyDisabled} onClick={onToggleApply} title="Apply to Selection">
        <Wand2 size={16} />
      </IconButton>
      {label && <span className={`picker-float-bar-label${importState.kind === 'error' ? ' error' : ''}`}>{label}</span>}
    </div>
  )
}
