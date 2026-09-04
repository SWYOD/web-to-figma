export type TopView = 'browser' | 'references'

interface Props {
  value: TopView
  onChange: (view: TopView) => void
}

/** Переключатель верхнего уровня "Браузер"/"Референсы" (по запросу
 *  пользователя — отдельная вкладка приложения для референсов, см.
 *  ReferencesView.tsx). Визуально — тот же сегмент-пилюля, что и остальные
 *  toolbar-кнопки (.icon-btn семейство), не Segmented из @web-to-figma/ui
 *  (тот рассчитан на компактные 2-3-словные опции внутри панели, здесь
 *  нужен более заметный, по центру toolbar). */
export function TopViewSwitch({ value, onChange }: Props): JSX.Element {
  return (
    <div className="top-view-switch">
      <button className={`top-view-switch-btn${value === 'browser' ? ' active' : ''}`} onClick={() => onChange('browser')}>
        Браузер
      </button>
      <button className={`top-view-switch-btn${value === 'references' ? ' active' : ''}`} onClick={() => onChange('references')}>
        Референсы
      </button>
    </div>
  )
}
