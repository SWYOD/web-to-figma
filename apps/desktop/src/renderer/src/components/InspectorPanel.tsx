import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { Block, BlockHead, Panel, PanelHead, PanelHeadActions, PanelTitle, Segmented, Switch } from '@web-to-figma/ui'
import { computeConfidenceScore, confidenceLevel, type ConfidenceLevel } from '@web-to-figma/conversion-engine'
import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { AppSettings, ElementSummary, ElementTreeNode, PickState } from '../../../shared/types'

const LEVEL_LABEL: Record<ConfidenceLevel, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' }

const EMPTY_PICK: PickState = { active: false, error: null }
const TRANSPARENT = /^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/i

interface Props {
  /** См. LeftSidebar.tsx Props.pinAction — тот же паттерн: кнопка pin для
   *  float-режима рендерится в шапку панели, а не абсолютным слоем поверх. */
  pinAction?: ReactNode
}

export function InspectorPanel({ pinAction }: Props): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [selection, setSelection] = useState<ElementSummary | null>(null)
  const [elementTree, setElementTree] = useState<ElementTreeNode | null>(null)
  const [elementTreeParent, setElementTreeParent] = useState<ElementTreeNode | null>(null)
  const [diagnostics, setDiagnostics] = useState<ConversionWarning[]>([])

  useEffect(() => {
    // Панель могла быть закрыта (не смонтирована) в момент клика пикером —
    // пропустила live-событие ниже. Подхватываем уже сделанный выбор при
    // каждом монтировании, а не остаёмся в пустом состоянии до следующего клика.
    window.api.inspectorGetLastSelection().then((result) => {
      if (!result) return
      setSelection(result.element)
      setElementTree(result.tree)
      setElementTreeParent(result.treeParent)
      setDiagnostics(result.diagnostics)
    })

    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection((result) => {
      setSelection(result.element)
      setElementTree(result.tree)
      setElementTreeParent(result.treeParent)
      setDiagnostics(result.diagnostics)
      setPick(EMPTY_PICK)
    })
    const offCleared = window.api.onInspectorSelectionCleared(() => {
      setSelection(null)
      setElementTree(null)
      setElementTreeParent(null)
      setDiagnostics([])
    })
    return () => {
      offPick()
      offSelection()
      offCleared()
    }
  }, [])

  useEffect(() => {
    if (!pick.active && !selection) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (pick.active) window.api.inspectorStopPick()
      // Иначе — Esc с уже выбранным элементом снимает выделение (по запросу
      // пользователя: раньше подсветку на странице нечем было убрать).
      else window.api.inspectorClearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pick.active, selection])

  const showDetails = selection && !pick.active
  const confidence = useMemo(() => computeConfidenceScore(diagnostics), [diagnostics])
  const level = confidenceLevel(confidence)
  // Схлопываем по `code` — при выборе крупного блока один и тот же диагноз
  // (напр. "родитель не Flex-контейнер") может повториться на десятках
  // вложенных узлов; без группировки список превращается в стену
  // одинаковых строк вместо полезной сводки (реальный отзыв пользователя:
  // выбор большого блока википедии "засрал всю панель ошибками"). Скор
  // confidence по-прежнему считается по ПОЛНОМУ недедуплицированному списку
  // ниже — штраф должен расти с числом затронутых узлов, схлопывание только
  // для отображения.
  const groupedDiagnostics = useMemo(() => {
    const byCode = new Map<string, { code: string; severity: ConversionWarning['severity']; message: string; count: number }>()
    for (const d of diagnostics) {
      const existing = byCode.get(d.code)
      if (existing) existing.count += 1
      else byCode.set(d.code, { code: d.code, severity: d.severity, message: d.message, count: 1 })
    }
    return [...byCode.values()]
  }, [diagnostics])

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Inspector</PanelTitle>
        {pinAction && <PanelHeadActions>{pinAction}</PanelHeadActions>}
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
      {showDetails && elementTree && (
        <Block>
          <BlockHead>Element tree</BlockHead>
          <CompactElementTree tree={elementTree} parent={elementTreeParent} />
        </Block>
      )}
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
          {groupedDiagnostics.length === 0 ? (
            <div className="placeholder-hint">Диагностик нет — элемент конвертируется без известных приближений.</div>
          ) : (
            groupedDiagnostics.map((d) => (
              <div key={d.code} className={`diagnostic-row ${d.severity}`}>
                {d.message}
                {d.count > 1 && <span className="diagnostic-count"> × {d.count}</span>}
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

function CompactElementTree({ tree, parent }: { tree: ElementTreeNode; parent: ElementTreeNode | null }): JSX.Element {
  const displayTree = useMemo<ElementTreeNode>(() => (parent ? { ...parent, children: [tree] } : tree), [parent, tree])
  const defaultExpanded = (): Set<string> => new Set([displayTree.key, tree.key])
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded)

  // Изначально видны ровно три смысловых уровня: parent → current → children.
  // Внуки остаются свёрнутыми, пока пользователь явно не раскроет ветку.
  useEffect(() => setExpanded(defaultExpanded()), [displayTree, tree.key])

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderNode = (node: ElementTreeNode, depth: number): JSX.Element => {
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(node.key)
    const visibleClasses = node.classes.slice(0, 2)
    return (
      <div className="element-tree-branch" key={node.key}>
        <button
          type="button"
          className={`element-tree-row${node.key === tree.key ? ' selected' : ''}`}
          style={{ paddingLeft: `${6 + depth * 13}px` }}
          // Клик по строке переключает текущее выделение на этот DOM-элемент
          // (см. main/inspector.ts selectBySourceSelector) — по запросу
          // пользователя, раньше дерево было доступно только для просмотра.
          // Раскрытие/сворачивание ветки — отдельный клик по шеврону (см.
          // ниже), чтобы не выбирать элемент случайно вместе с разворачиванием
          // поддерева. Узлы без sourceSelector (не должно случаться для
          // preview-снапшота, но на всякий случай) просто не кликабельны.
          onClick={() => node.sourceSelector && void window.api.inspectorSelectTreeNode(node.sourceSelector)}
          title={node.text || undefined}
        >
          <span
            className="element-tree-chevron"
            role={hasChildren ? 'button' : undefined}
            aria-expanded={hasChildren ? isExpanded : undefined}
            onClick={(e) => {
              if (!hasChildren) return
              e.stopPropagation()
              toggle(node.key)
            }}
          >
            {hasChildren ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
          </span>
          <span className="element-tree-tag">{node.tag}</span>
          {node.id && <span className="element-tree-id">#{node.id}</span>}
          {visibleClasses.map((name) => (
            <span className="element-tree-class" key={name}>.{name}</span>
          ))}
          {node.classes.length > visibleClasses.length && (
            <span className="element-tree-more">+{node.classes.length - visibleClasses.length}</span>
          )}
          {node.text && <span className="element-tree-text">“{node.text}”</span>}
        </button>
        {hasChildren && isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return <div className="element-tree">{renderNode(displayTree, 0)}</div>
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

  const update = (
    patch: Partial<
      Pick<AppSettings, 'useMatchedTextStyles' | 'useMatchedColorStyles' | 'colorMatchSource' | 'alsoCreateInstance'>
    >
  ): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <>
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
        {settings.useMatchedColorStyles && (
          <Segmented
            value={settings.colorMatchSource}
            onChange={(v) => update({ colorMatchSource: v })}
            options={[
              { value: 'style', label: 'Style' },
              { value: 'variable', label: 'Variable' }
            ]}
          />
        )}
        <div className="placeholder-hint">
          Вместо исходных значений — ближайший локальный text style файла (шрифт — по кеглю и весу начертания) и{' '}
          {settings.colorMatchSource === 'variable' ? 'color variable' : 'paint style'} для цвета (по расстоянию в
          RGBA). Если подходящего кандидата нет — используется исходное значение.
        </div>
      </Block>
      <Block>
        <BlockHead>Импорт как компонент</BlockHead>
        <div className="prop-row">
          <span className="prop-label">Также создать Instance</span>
          <Switch checked={settings.alsoCreateInstance} onChange={(v) => update({ alsoCreateInstance: v })} />
        </div>
        <div className="placeholder-hint">
          Кнопка «Import as Component» на тулбаре создаёт выбранный элемент как Figma Component. Если включено —
          рядом сразу появится один его Instance.
        </div>
      </Block>
    </>
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
