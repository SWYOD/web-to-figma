import { useEffect, useState } from 'react'
import { Switch, ToolbarButton } from '@web-to-figma/ui'
import type { ApplyStylesTargets } from '../../../shared/types'

const ALL_TARGETS: ApplyStylesTargets = {
  typography: true,
  fill: true,
  border: true,
  radius: true,
  effects: true,
  layout: true,
  dimensions: true
}

const TARGET_LABELS: { key: keyof ApplyStylesTargets; label: string }[] = [
  { key: 'typography', label: 'Typography' },
  { key: 'fill', label: 'Fill' },
  { key: 'border', label: 'Border' },
  { key: 'radius', label: 'Radius' },
  { key: 'effects', label: 'Effects' },
  { key: 'layout', label: 'Auto Layout' },
  { key: 'dimensions', label: 'Dimensions' }
]

type ApplyUiState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ok'; appliedTo: number; skipped: string[] }
  | { kind: 'error'; message: string }

/**
 * Тело попапа Apply to Selection — вынесено из `ApplyToSelectionPopover` в
 * отдельный компонент, т.к. теперь рендерится в СОВСЕМ ДРУГОМ рендерере
 * (overlay-слой поверх браузера, см. `OverlayRoot.tsx`/`main/overlay.ts`), не
 * внутри `Popover` главного окна. Полностью самодостаточен (свой
 * targets/applyState, своя подписка на `onInspectorSelection`) — не получает
 * пропсов из главного окна, т.к. это два независимых React-дерева/процесса.
 * Верстка (`.popover-section`/`.popover-row`) намеренно переиспользует те же
 * классы, что и раньше в Popover, чтобы выглядело идентично.
 */
export function ApplyToSelectionContent(): JSX.Element {
  const [hasSelection, setHasSelection] = useState(false)
  const [targets, setTargets] = useState<ApplyStylesTargets>(ALL_TARGETS)
  const [state, setState] = useState<ApplyUiState>({ kind: 'idle' })

  useEffect(() => {
    // Компонент монтируется ЗАНОВО при каждом открытии попапа (условный
    // рендер в OverlayRoot) — обычный порядок действий "выбрать элемент,
    // потом открыть Apply to Selection" означает, что live-событие ниже уже
    // произошло и пропущено. Подхватываем уже сделанный выбор явным
    // запросом, тот же приём, что и в InspectorPanel.tsx.
    window.api.inspectorGetLastSelection().then((result) => {
      if (result) setHasSelection(true)
    })
    return window.api.onInspectorSelection(() => {
      setHasSelection(true)
      setState({ kind: 'idle' })
    })
  }, [])

  const handleApply = async (): Promise<void> => {
    setState({ kind: 'loading' })
    const result = await window.api.inspectorApplyStyles(targets)
    setState(
      result.ok
        ? { kind: 'ok', appliedTo: result.appliedTo ?? 0, skipped: result.skipped ?? [] }
        : { kind: 'error', message: result.error ?? 'Не удалось применить стили' }
    )
  }

  return (
    <div className="popover overlay-popover">
      <div className="popover-section">
        <div className="popover-label">Apply to Selection</div>
        {!hasSelection ? (
          <div className="placeholder-hint">Сначала выберите элемент через Inspector.</div>
        ) : (
          <>
            <div className="placeholder-hint">
              Перенести выбранные категории стилей на уже выделенные слои в Figma (не создаёт новых нод).
            </div>
            {TARGET_LABELS.map(({ key, label }) => (
              <div key={key} className="popover-row">
                <span>{label}</span>
                <Switch checked={targets[key]} onChange={(v) => setTargets((t) => ({ ...t, [key]: v }))} />
              </div>
            ))}
            <ToolbarButton primary disabled={state.kind === 'loading'} onClick={handleApply}>
              {state.kind === 'loading' ? 'Применение…' : 'Apply to Selection'}
            </ToolbarButton>
            {state.kind === 'ok' && (
              <div className="import-status ok">
                Применено к {state.appliedTo} слоям.
                {state.skipped.length > 0 && (
                  <ul className="apply-skipped-list">
                    {state.skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {state.kind === 'error' && <div className="import-status error">{state.message}</div>}
          </>
        )}
      </div>
    </div>
  )
}
