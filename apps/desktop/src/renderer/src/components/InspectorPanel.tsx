import { useEffect, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Block, BlockHead, IconButton, Panel, PanelHead, PanelHeadActions, PanelTitle } from '@web-to-figma/ui'
import type { ElementSummary, PickState } from '../../../shared/types'

const EMPTY_PICK: PickState = { active: false, error: null }

export function InspectorPanel(): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [selection, setSelection] = useState<ElementSummary | null>(null)

  useEffect(() => {
    const offPick = window.api.onInspectorPickState(setPick)
    const offSelection = window.api.onInspectorSelection((element) => {
      setSelection(element)
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

  const togglePick = (): void => {
    if (pick.active) window.api.inspectorStopPick()
    else window.api.inspectorStartPick()
  }

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Inspector</PanelTitle>
        <PanelHeadActions>
          <IconButton active={pick.active} onClick={togglePick} title="Select element (Esc — отмена)">
            <MousePointerClick size={15} />
          </IconButton>
        </PanelHeadActions>
      </PanelHead>
      <Block>
        <BlockHead>Element picker</BlockHead>
        {pick.error && <div className="inspector-error">{pick.error}</div>}
        {pick.active && <div className="placeholder-hint">Наведите на элемент на странице и кликните. Esc — отмена.</div>}
        {!pick.active && !selection && (
          <div className="placeholder-hint">
            Нажмите на иконку выше и кликните на элемент страницы, чтобы выбрать его.
          </div>
        )}
        {selection && !pick.active && <SelectionCard element={selection} />}
      </Block>
    </Panel>
  )
}

function SelectionCard({ element }: { element: ElementSummary }): JSX.Element {
  const selector = `${element.tag}${element.id ? `#${element.id}` : ''}${element.classes.map((c) => `.${c}`).join('')}`
  return (
    <div className="element-summary">
      <div className="element-summary-selector">{selector}</div>
      <div className="element-summary-size">
        {element.width} × {element.height}
      </div>
    </div>
  )
}
