import { useEffect, useState } from 'react'
import { Block, BlockHead, Panel, PanelHead, PanelTitle, Switch, ToolbarButton } from '@web-to-figma/ui'
import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { ApplyStylesTargets, ElementSummary, PickState } from '../../../shared/types'

const EMPTY_PICK: PickState = { active: false, error: null }
const TRANSPARENT = /^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/i

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

type ImportUiState = { kind: 'idle' | 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }
type ApplyUiState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ok'; appliedTo: number; skipped: string[] }
  | { kind: 'error'; message: string }

export function InspectorPanel(): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [selection, setSelection] = useState<ElementSummary | null>(null)
  const [diagnostics, setDiagnostics] = useState<ConversionWarning[]>([])
  const [importState, setImportState] = useState<ImportUiState>({ kind: 'idle' })
  const [applyTargets, setApplyTargets] = useState<ApplyStylesTargets>(ALL_TARGETS)
  const [applyState, setApplyState] = useState<ApplyUiState>({ kind: 'idle' })

  useEffect(() => {
    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection((result) => {
      setSelection(result.element)
      setDiagnostics(result.diagnostics)
      setPick(EMPTY_PICK)
      setImportState({ kind: 'idle' })
      setApplyState({ kind: 'idle' })
    })
    return () => {
      offPick()
      offSelection()
    }
  }, [])

  const handleImport = async (): Promise<void> => {
    setImportState({ kind: 'loading' })
    const result = await window.api.inspectorImportAsFrame()
    setImportState(result.ok ? { kind: 'ok' } : { kind: 'error', message: result.error ?? 'Не удалось импортировать' })
  }

  const handleApply = async (): Promise<void> => {
    setApplyState({ kind: 'loading' })
    const result = await window.api.inspectorApplyStyles(applyTargets)
    setApplyState(
      result.ok
        ? { kind: 'ok', appliedTo: result.appliedTo ?? 0, skipped: result.skipped ?? [] }
        : { kind: 'error', message: result.error ?? 'Не удалось применить стили' }
    )
  }

  useEffect(() => {
    if (!pick.active) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.inspectorStopPick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pick.active])

  const showDetails = selection && !pick.active

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Inspector</PanelTitle>
      </PanelHead>
      <Block>
        <BlockHead>Element picker</BlockHead>
        {pick.error && <div className="inspector-error">{pick.error}</div>}
        {pick.active && <div className="placeholder-hint">Наведите на элемент на странице и кликните. Esc — отмена.</div>}
        {!pick.active && !selection && (
          <div className="placeholder-hint">
            Нажмите на иконку picker'а над браузерной областью и кликните на элемент страницы, чтобы выбрать его.
          </div>
        )}
        {showDetails && (
          <>
            <SelectionCard element={selection} />
            <ToolbarButton primary disabled={importState.kind === 'loading'} onClick={handleImport}>
              {importState.kind === 'loading' ? 'Импорт…' : 'Import as Frame'}
            </ToolbarButton>
            {importState.kind === 'ok' && <div className="import-status ok">Frame создан в Figma.</div>}
            {importState.kind === 'error' && <div className="import-status error">{importState.message}</div>}
          </>
        )}
      </Block>
      {showDetails && (
        <Block>
          <BlockHead>Apply to Selection</BlockHead>
          <div className="placeholder-hint" style={{ marginBottom: 8 }}>
            Перенести выбранные категории стилей на уже выделенные слои в Figma (не создаёт новых нод).
          </div>
          {TARGET_LABELS.map(({ key, label }) => (
            <div key={key} className="target-row">
              <span>{label}</span>
              <Switch checked={applyTargets[key]} onChange={(v) => setApplyTargets((t) => ({ ...t, [key]: v }))} />
            </div>
          ))}
          <ToolbarButton primary disabled={applyState.kind === 'loading'} onClick={handleApply}>
            {applyState.kind === 'loading' ? 'Применение…' : 'Apply to Selection'}
          </ToolbarButton>
          {applyState.kind === 'ok' && (
            <div className="import-status ok">
              Применено к {applyState.appliedTo} слоям.
              {applyState.skipped.length > 0 && (
                <ul className="apply-skipped-list">
                  {applyState.skipped.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {applyState.kind === 'error' && <div className="import-status error">{applyState.message}</div>}
        </Block>
      )}
      {showDetails && (
        <>
          <Block>
            <BlockHead>Layout</BlockHead>
            <PropRow label="Size" value={`${selection.width} × ${selection.height}`} />
            <PropRow label="Display" value={selection.layout.display} />
            <PropRow label="Position" value={selection.layout.position} />
            <PropRow label="Padding" value={selection.layout.padding} />
            {selection.layout.flexDirection && <PropRow label="Direction" value={selection.layout.flexDirection} />}
            {selection.layout.gap && <PropRow label="Gap" value={selection.layout.gap} />}
            {selection.layout.justifyContent && <PropRow label="Justify" value={selection.layout.justifyContent} />}
            {selection.layout.alignItems && <PropRow label="Align" value={selection.layout.alignItems} />}
          </Block>
          <Block>
            <BlockHead>Typography</BlockHead>
            <PropRow label="Font" value={selection.typography.fontFamily} />
            <PropRow label="Size / Line" value={`${selection.typography.fontSize} / ${selection.typography.lineHeight}`} />
            <PropRow label="Weight" value={selection.typography.fontWeight} />
            <PropRow label="Color" value={selection.typography.color} swatch={selection.typography.color} />
          </Block>
          <Block>
            <BlockHead>Fill</BlockHead>
            <PropRow label="Background" value={selection.appearance.backgroundColor} swatch={selection.appearance.backgroundColor} />
          </Block>
          {selection.appearance.border && (
            <Block>
              <BlockHead>Border</BlockHead>
              <PropRow label="Border" value={selection.appearance.border} />
            </Block>
          )}
          {selection.appearance.borderRadius && (
            <Block>
              <BlockHead>Radius</BlockHead>
              <PropRow label="Radius" value={selection.appearance.borderRadius} />
            </Block>
          )}
          {selection.appearance.boxShadow !== 'none' && (
            <Block>
              <BlockHead>Shadow</BlockHead>
              <PropRow label="Shadow" value={selection.appearance.boxShadow} />
            </Block>
          )}
          {diagnostics.length > 0 && (
            <Block>
              <BlockHead>Diagnostics</BlockHead>
              {diagnostics.map((d, i) => (
                <div key={i} className={`diagnostic-row ${d.severity}`}>
                  {d.message}
                </div>
              ))}
            </Block>
          )}
        </>
      )}
    </Panel>
  )
}

function SelectionCard({ element }: { element: ElementSummary }): JSX.Element {
  const selector = `${element.tag}${element.id ? `#${element.id}` : ''}${element.classes.map((c) => `.${c}`).join('')}`
  return (
    <div className="element-summary">
      <div className="element-summary-selector">{selector}</div>
    </div>
  )
}

function PropRow({ label, value, swatch }: { label: string; value: string; swatch?: string }): JSX.Element {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-value">
        {swatch && !TRANSPARENT.test(swatch) && <span className="prop-swatch" style={{ background: swatch }} />}
        {value}
      </span>
    </div>
  )
}
