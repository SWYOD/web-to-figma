import { useEffect, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { PickState } from '../../../shared/types'

const EMPTY_PICK: PickState = { active: false, error: null }

/**
 * Плавающий пилл-тулбар над браузерной областью (в духе Figma) — единственное
 * место, откуда теперь запускается element picker (раньше — кнопка в шапке
 * InspectorPanel). WebContentsView всегда рисуется НАД HTML своего
 * bounds-прямоугольника (см. main/browser.ts) — бар не перекрывается страницей
 * потому что сидит в полосе, специально исключённой из bounds `.browser-viewport`
 * (см. styles.css: `.browser-viewport-wrap`/`.browser-viewport` inset с bottom).
 * InspectorPanel по-прежнему держит свой pick-state (Escape-хендлер, error-текст),
 * это независимый второй подписчик на тот же IPC-стейт — оба легитимны.
 */
export function PickerFloatBar(): JSX.Element {
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)

  useEffect(() => window.api.onInspectorPickState(setPick), [])

  const togglePick = (): void => {
    if (pick.active) window.api.inspectorStopPick()
    else window.api.inspectorStartPick()
  }

  return (
    <div className="picker-float-bar">
      <IconButton active={pick.active} onClick={togglePick} title="Select element (Esc — отмена)">
        <MousePointerClick size={16} />
      </IconButton>
      {pick.active && <span className="picker-float-bar-label">Кликните на элемент страницы</span>}
    </div>
  )
}
