import { useEffect, useState } from 'react'
import { Frame as FrameIcon, MousePointerClick } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { PickState } from '../../../shared/types'
import { ApplyToSelectionPopover } from './ApplyToSelectionPopover'

const EMPTY_PICK: PickState = { active: false, error: null }

type ImportUiState = { kind: 'idle' | 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

/**
 * Плавающий пилл-тулбар над браузерной областью (в духе Figma) — единственное
 * место для всех действий над текущим выбором: pick, Import as Frame, Apply
 * to Selection (раньше — разбросаны по шапке InspectorPanel/toolbar; собраны
 * сюда по запросу пользователя, той же группой, что тулбар инструментов в
 * самой Figma). WebContentsView всегда рисуется НАД HTML своего
 * bounds-прямоугольника (см. main/browser.ts) — бар не перекрывается страницей
 * потому что сидит в полосе, специально исключённой из bounds `.browser-viewport`
 * (см. styles.css: `.browser-viewport-wrap`/`.browser-viewport` inset с bottom).
 * Apply to Selection раскрывает попап вверх (`placement="up"`) — вниз от
 * нижнего бара раскрываться некуда.
 */
export function PickerFloatBar(): JSX.Element {
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
      <ApplyToSelectionPopover />
      {label && <span className={`picker-float-bar-label${importState.kind === 'error' ? ' error' : ''}`}>{label}</span>}
    </div>
  )
}
