import { useEffect, useState } from 'react'
import { Component as ComponentIcon, FolderInput, Frame as FrameIcon, ListPlus, MousePointerClick, Wand2 } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { PickState } from '../../../shared/types'

const EMPTY_PICK: PickState = { active: false, error: null }

type ImportUiState = { kind: 'idle' | 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

interface Props {
  applyOpen: boolean
  onToggleApply: () => void
  applyDisabled: boolean
  /** Queue-режим (мульти-импорт, по запросу пользователя) — см.
   *  main/inspector.ts ElementPicker класс-докстринг. Счётчик/тоггл живут в
   *  OverlayRoot (та же причина, что у applyOpen выше — состояние общее с
   *  QueueConfirmCard, который рендерится там же, не внутри этого компонента). */
  queueMode: boolean
  onToggleQueueMode: () => void
  queueCount: number
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
export function PickerFloatBar({ applyOpen, onToggleApply, applyDisabled, queueMode, onToggleQueueMode, queueCount }: Props): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [hasSelection, setHasSelection] = useState(false)
  const [importState, setImportState] = useState<ImportUiState>({ kind: 'idle' })
  const [componentImportState, setComponentImportState] = useState<ImportUiState>({ kind: 'idle' })
  const [queueImportState, setQueueImportState] = useState<ImportUiState>({ kind: 'idle' })

  useEffect(() => {
    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection(() => {
      setHasSelection(true)
      setImportState({ kind: 'idle' })
      setComponentImportState({ kind: 'idle' })
    })
    // Esc с уже выбранным элементом (см. main/inspector.ts clearSelection) —
    // кнопки Import as Frame/Component снова недоступны до нового выбора.
    const offCleared = window.api.onInspectorSelectionCleared(() => {
      setHasSelection(false)
      setImportState({ kind: 'idle' })
      setComponentImportState({ kind: 'idle' })
    })
    return () => {
      offPick()
      offSelection()
      offCleared()
    }
  }, [])

  // Esc, когда фокус ОС на overlay-рендерере (не на встроенной странице,
  // где это же ловит main/inspector.ts через before-input-event) — снимает
  // выделение, только если сейчас НЕ идёт активный pick (тот уже обрабатывает
  // свой Esc сам через inspectorStopPick, см. togglePick ниже).
  useEffect(() => {
    if (pick.active || !hasSelection) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.inspectorClearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pick.active, hasSelection])

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

  const handleImportComponent = async (): Promise<void> => {
    setComponentImportState({ kind: 'loading' })
    const settings = await window.api.getSettings()
    const result = await window.api.inspectorImportAsComponent(
      settings.useMatchedTextStyles,
      settings.useMatchedColorStyles,
      settings.colorMatchSource,
      settings.alsoCreateInstance
    )
    setComponentImportState(result.ok ? { kind: 'ok' } : { kind: 'error', message: result.error ?? 'Не удалось импортировать' })
  }

  const handleImportQueue = async (): Promise<void> => {
    setQueueImportState({ kind: 'loading' })
    const settings = await window.api.getSettings()
    const result = await window.api.inspectorImportQueue(
      settings.useMatchedTextStyles,
      settings.useMatchedColorStyles,
      settings.colorMatchSource
    )
    setQueueImportState(
      result.ok
        ? { kind: 'ok' }
        : { kind: 'error', message: result.error ?? `Импортировано ${result.imported}, ошибок: ${result.failed}` }
    )
  }

  const label = pick.active
    ? queueMode
      ? 'Кликните на следующий элемент'
      : 'Кликните на элемент страницы'
    : queueImportState.kind === 'ok'
      ? 'Очередь импортирована в Figma'
      : queueImportState.kind === 'error'
        ? queueImportState.message
        : componentImportState.kind === 'ok'
          ? 'Component создан в Figma'
          : componentImportState.kind === 'error'
            ? componentImportState.message
            : importState.kind === 'ok'
              ? 'Frame создан в Figma'
              : importState.kind === 'error'
                ? importState.message
                : null
  const hasError =
    importState.kind === 'error' || componentImportState.kind === 'error' || queueImportState.kind === 'error'

  return (
    <div className="picker-float-bar">
      <IconButton active={pick.active} onClick={togglePick} title="Select element (Esc — отмена)">
        <MousePointerClick size={16} />
      </IconButton>
      <div className="tb-sep" />
      <IconButton disabled={!hasSelection || importState.kind === 'loading'} onClick={handleImport} title="Import as Frame">
        <FrameIcon size={16} />
      </IconButton>
      <IconButton
        disabled={!hasSelection || componentImportState.kind === 'loading'}
        onClick={handleImportComponent}
        title="Import as Component"
      >
        <ComponentIcon size={16} />
      </IconButton>
      <IconButton active={applyOpen} disabled={applyDisabled} onClick={onToggleApply} title="Apply to Selection">
        <Wand2 size={16} />
      </IconButton>
      <div className="tb-sep" />
      <IconButton
        active={queueMode}
        onClick={onToggleQueueMode}
        title={queueMode ? 'Выключить мульти-выбор' : 'Мульти-выбор: выбирать по одному, импортировать разом'}
      >
        <ListPlus size={16} />
      </IconButton>
      <div className="picker-float-bar-queue-import">
        <IconButton
          disabled={queueCount === 0 || queueImportState.kind === 'loading'}
          onClick={handleImportQueue}
          title={`Импортировать очередь (${queueCount})`}
        >
          <FolderInput size={16} />
        </IconButton>
        {queueCount > 0 && <span className="picker-float-bar-queue-badge">{queueCount}</span>}
      </div>
      {label && <span className={`picker-float-bar-label${hasError ? ' error' : ''}`}>{label}</span>}
    </div>
  )
}
