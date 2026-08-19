import { Check, Trash2 } from 'lucide-react'
import type { ThemeDef } from '@web-to-figma/ui'

interface Props {
  theme: ThemeDef
  active: boolean
  onClick: () => void
  onRemove?: () => void
}

/**
 * Компактная карточка темы в галерее — портировано из ThemeCard Skill-tree
 * (SVG-превью + свотчи + название), но силуэт превью адаптирован под ЭТО
 * приложение: у Skill-tree там мини-граф скилл-три (MiniSkillGraph), у нас
 * нет ни графа, ни branchColors — вместо этого мини-макет РЕАЛЬНОГО shell'а
 * (toolbar + левый сайдбар + браузерная область + правая панель), горстка
 * прямоугольников, не литеративная иллюстрация (см. docs/design-system.md §7).
 */
export function ThemeCard({ theme, active, onClick, onRemove }: Props): JSX.Element {
  const v = theme.vars
  return (
    <button className={`theme-card${active ? ' active' : ''}`} onClick={onClick} title={theme.name}>
      <svg viewBox="0 0 140 88" width="100%" className="theme-card-preview">
        <rect x="0" y="0" width="140" height="88" fill={v.bg} />
        <rect x="0" y="0" width="140" height="10" fill={v['bg-panel']} />
        <circle cx="8" cy="5" r="1.6" fill={v.accent} />
        <rect x="0" y="10" width="26" height="78" fill={v['bg-panel']} />
        <rect x="6" y="18" width="14" height="4" rx="1.5" fill={v['text-faint']} />
        <rect x="6" y="26" width="14" height="4" rx="1.5" fill={v.accent} opacity="0.75" />
        <rect x="6" y="34" width="14" height="4" rx="1.5" fill={v['text-faint']} />
        <rect x="30" y="14" width="72" height="70" rx="3" fill={v['bg-canvas']} stroke={v.border} />
        <rect x="106" y="14" width="34" height="70" rx="3" fill={v.surface} stroke={v.border} />
        <rect x="111" y="20" width="24" height="3" rx="1.5" fill={v['text-dim']} />
        <rect x="111" y="28" width="18" height="6" rx="2" fill={v['accent-soft']} />
      </svg>
      <div className="theme-card-footer">
        <span className="theme-card-name">{theme.name}</span>
        {active && <Check size={13} className="theme-card-check" />}
        {onRemove && !active && (
          <span
            className="icon-btn xs danger theme-card-remove"
            title="Удалить тему"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={12} />
          </span>
        )}
      </div>
      <div className="theme-card-swatches">
        {[v.accent, v.danger, v.warning, v.info, v.success].map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </div>
    </button>
  )
}
