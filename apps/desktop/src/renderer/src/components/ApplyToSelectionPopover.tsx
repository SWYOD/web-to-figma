import { useEffect, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { IconButton, Popover, Switch, ToolbarButton } from '@web-to-figma/ui'
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
 * Вынесено из InspectorPanel в toolbar (по запросу пользователя) — Apply to
 * Selection нужен из любого места, не только когда правая панель открыта.
 * Держит собственное состояние targets/applyState независимо от
 * InspectorPanel — та же "самодостаточный popover" схема, что и
 * BridgePopover/SettingsPopover; знает про наличие выбранного элемента через
 * тот же `onInspectorSelection`-листенер, что и InspectorPanel (несколько
 * подписчиков на одно IPC-событие — штатно, см. preload/index.ts).
 */
export function ApplyToSelectionPopover({ placement = 'down' }: { placement?: 'down' | 'up' | 'up-stretch' }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [targets, setTargets] = useState<ApplyStylesTargets>(ALL_TARGETS)
  const [state, setState] = useState<ApplyUiState>({ kind: 'idle' })

  useEffect(() => {
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
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={placement}
      anchor={
        <IconButton active={open} disabled={!hasSelection} onClick={() => setOpen((v) => !v)} title="Apply to Selection">
          <Wand2 size={16} />
        </IconButton>
      }
    >
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
    </Popover>
  )
}
