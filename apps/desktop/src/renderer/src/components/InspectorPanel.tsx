import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Block, BlockHead, Panel, PanelHead, PanelTitle, Switch } from '@web-to-figma/ui'
import { computeConfidenceScore, confidenceLevel, type ConfidenceLevel } from '@web-to-figma/conversion-engine'
import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { AppSettings, ElementSummary, PickState } from '../../../shared/types'

const LEVEL_LABEL: Record<ConfidenceLevel, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' }

const EMPTY_PICK: PickState = { active: false, error: null }
const TRANSPARENT = /^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/i

export function InspectorPanel(): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [selection, setSelection] = useState<ElementSummary | null>(null)
  const [diagnostics, setDiagnostics] = useState<ConversionWarning[]>([])

  useEffect(() => {
    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection((result) => {
      setSelection(result.element)
      setDiagnostics(result.diagnostics)
      setPick(EMPTY_PICK)
    })
    return () => {
      offPick()
      offSelection()
    }
  }, [])

  useEffect(() => {
    if (!pick.active) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.inspectorStopPick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pick.active])

  const showDetails = selection && !pick.active
  const confidence = useMemo(() => computeConfidenceScore(diagnostics), [diagnostics])
  const level = confidenceLevel(confidence)

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
        {showDetails && <SelectionCard element={selection} />}
      </Block>
      <ImportStylesBlock />
      {showDetails && (
        <Block>
          <BlockHead>Import Quality</BlockHead>
          <div className="confidence-row">
            <div className="confidence-bar">
              <div className={`confidence-bar-fill ${level}`} style={{ width: `${confidence}%` }} />
            </div>
            <span className={`confidence-value ${level}`}>
              {confidence}% · {LEVEL_LABEL[level]}
            </span>
          </div>
          {diagnostics.length === 0 ? (
            <div className="placeholder-hint">Диагностик нет — элемент конвертируется без известных приближений.</div>
          ) : (
            diagnostics.map((d, i) => (
              <div key={i} className={`diagnostic-row ${d.severity}`}>
                {d.message}
              </div>
            ))
          )}
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
        </>
      )}
    </Panel>
  )
}

/**
 * "Стили проекта" — независимо от текущего выбора (не под `showDetails`,
 * это глобальная настройка Import as Frame, а не свойство элемента). Раньше
 * жила как один общий переключатель в попапе над плавающим баром
 * (`ImportSettingsPopover`) — по запросу пользователя вынесена в правую
 * панель и разделена на два независимых тумблера (шрифты/цвета), т.к.
 * пользователь может захотеть матчить, например, только цвета, не трогая
 * шрифты. Читает/пишет `AppSettings` напрямую (тот же самодостаточный
 * паттерн, что у других popover'ов) — `PickerFloatBar.handleImport()`
 * перечитывает актуальные значения в момент клика на Import as Frame.
 */
function ImportStylesBlock(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  if (!settings) return null

  const update = (patch: Partial<Pick<AppSettings, 'useMatchedTextStyles' | 'useMatchedColorStyles'>>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <Block>
      <BlockHead>Стили проекта при импорте</BlockHead>
      <div className="prop-row">
        <span className="prop-label">Шрифты</span>
        <Switch checked={settings.useMatchedTextStyles} onChange={(v) => update({ useMatchedTextStyles: v })} />
      </div>
      <div className="prop-row">
        <span className="prop-label">Цвета</span>
        <Switch checked={settings.useMatchedColorStyles} onChange={(v) => update({ useMatchedColorStyles: v })} />
      </div>
      <div className="placeholder-hint">
        Вместо исходных значений — ближайший локальный text/paint style файла (шрифт — по кеглю, цвет — по расстоянию в
        RGBA). Если подходящего стиля нет — используется исходное значение.
      </div>
    </Block>
  )
}

function useCopy(value: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  return { copied, copy }
}

function SelectionCard({ element }: { element: ElementSummary }): JSX.Element {
  const tagAndId = `${element.tag}${element.id ? `#${element.id}` : ''}`
  const fullSelector = `${tagAndId}${element.classes.map((c) => `.${c}`).join('')}`
  const { copied, copy } = useCopy(fullSelector)
  return (
    <div className="element-summary" onClick={copy} title="Скопировать селектор" role="button">
      <div className="element-summary-head">
        <span className="element-summary-tag">{tagAndId}</span>
        {copied ? <Check size={13} className="copy-icon copied" /> : <Copy size={13} className="copy-icon" />}
      </div>
      {element.classes.length > 0 && (
        <div className="element-summary-classes">
          {element.classes.map((c, i) => (
            <span key={i} className="class-pill">.{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function PropRow({ label, value, swatch }: { label: string; value: string; swatch?: string }): JSX.Element {
  const { copied, copy } = useCopy(value)
  return (
    <div className="prop-row" onClick={copy} title="Скопировать значение" role="button">
      <span className="prop-label">{label}</span>
      <span className="prop-value">
        {swatch && !TRANSPARENT.test(swatch) && <span className="prop-swatch" style={{ background: swatch }} />}
        <span className="prop-value-text">{value}</span>
        {copied ? <Check size={12} className="copy-icon copied" /> : <Copy size={12} className="copy-icon" />}
      </span>
    </div>
  )
}
