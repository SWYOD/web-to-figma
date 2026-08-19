import { useState } from 'react'
import { Save, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Switch, THEME_VAR_KEYS } from '@web-to-figma/ui'
import type { ThemeDef, ThemeVars } from '@web-to-figma/ui'

const VAR_LABELS: Record<keyof ThemeVars, string> = {
  bg: 'Фон приложения',
  'bg-panel': 'Фон панелей',
  'bg-canvas': 'Фон браузерной области',
  surface: 'Поверхность',
  'surface-2': 'Поверхность (вторая)',
  hover: 'Наведение (hover)',
  border: 'Граница',
  'border-strong': 'Граница (акцент)',
  text: 'Текст',
  'text-dim': 'Текст приглушённый',
  'text-faint': 'Текст едва заметный',
  accent: 'Акцент',
  'accent-soft': 'Акцент (мягкий)',
  'accent-text': 'Текст на акценте',
  danger: 'Опасность/удаление',
  warning: 'Предупреждение',
  info: 'Информация',
  success: 'Успех',
  shadow: 'Тень'
}

interface Variant {
  vars: ThemeVars
}

function cloneVariant(vars: ThemeVars): Variant {
  return { vars: { ...vars } }
}

interface Props {
  /** Тема, от которой стартует черновик — обычно активная. Редактор всегда
   *  создаёт НОВУЮ кастомную тему (см. onSave), а не правит baseTheme на месте. */
  baseTheme: ThemeDef
  onClose: () => void
  onSave: (theme: ThemeDef) => void
}

/**
 * Полноценный редактор темы — портировано из ThemeEditor Skill-tree (форма
 * "цвет + текст" на каждый токен + живое превью), без поля шрифта (у этого
 * приложения нет системы кастомных шрифтов Skill-tree) и без branchColors
 * (см. docs/design-system.md §7). Поддерживает второй вид (altVariant) так
 * же, как встроенные темы.
 */
export function ThemeEditorModal({ baseTheme, onClose, onSave }: Props): JSX.Element {
  const [name, setName] = useState(`${baseTheme.name} (копия)`)
  const [dark, setDark] = useState(baseTheme.dark)
  const [primary, setPrimary] = useState<Variant>(() => cloneVariant(baseTheme.vars))
  const [hasAlt, setHasAlt] = useState(!!baseTheme.altVariant)
  const [alt, setAlt] = useState<Variant>(() => cloneVariant(baseTheme.altVariant?.vars ?? baseTheme.vars))

  function updateVar(which: 'primary' | 'alt', key: keyof ThemeVars, value: string): void {
    const setter = which === 'primary' ? setPrimary : setAlt
    setter((p) => ({ vars: { ...p.vars, [key]: value } }))
  }

  function handleSave(): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const theme: ThemeDef = {
      id: nanoid(),
      name: trimmed,
      dark,
      vars: primary.vars,
      ...(hasAlt ? { altVariant: { vars: alt.vars } } : {})
    }
    onSave(theme)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal theme-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Редактор темы</span>
          <div className="modal-head-actions">
            <button className="tb-btn primary" onClick={handleSave}>
              <Save size={14} /> Сохранить
            </button>
            <button className="icon-btn" onClick={onClose} title="Закрыть">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="theme-editor-body">
          <div className="theme-editor-form">
            <label className="settings-label">Название</label>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название темы"
            />

            <div className="settings-row" style={{ marginTop: 10 }}>
              <span>Тёмная по умолчанию</span>
              <Switch checked={dark} onChange={setDark} />
            </div>

            <VariantFields title="Основной вид" variant={primary} onVarChange={(k, v) => updateVar('primary', k, v)} />

            <div className="settings-row" style={{ marginTop: 16 }}>
              <span>Второй вид (тумблер тёмный/светлый)</span>
              <Switch checked={hasAlt} onChange={setHasAlt} />
            </div>

            {hasAlt && (
              <VariantFields
                title={dark ? 'Светлый вид' : 'Тёмный вид'}
                variant={alt}
                onVarChange={(k, v) => updateVar('alt', k, v)}
              />
            )}
          </div>

          <div className="theme-editor-preview">
            <label className="settings-label">Превью — основной вид</label>
            <ThemePreviewMock vars={primary.vars} label={name || 'Без названия'} />
            {hasAlt && (
              <>
                <label className="settings-label" style={{ marginTop: 4 }}>
                  Превью — {dark ? 'светлый' : 'тёмный'} вид
                </label>
                <ThemePreviewMock vars={alt.vars} label={name || 'Без названия'} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function VariantFields({
  title,
  variant,
  onVarChange
}: {
  title: string
  variant: Variant
  onVarChange: (key: keyof ThemeVars, value: string) => void
}): JSX.Element {
  return (
    <div className="theme-editor-variant">
      <label className="settings-label">{title}</label>
      {THEME_VAR_KEYS.map((key) => {
        const raw = variant.vars[key] ?? ''
        return (
          <div className="theme-editor-row" key={key}>
            <span className="theme-editor-row-label">{VAR_LABELS[key]}</span>
            <input
              type="color"
              className="swatch-custom"
              value={/^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#000000'}
              onChange={(e) => onVarChange(key, e.target.value)}
            />
            <input
              type="text"
              className="theme-editor-row-text"
              value={raw}
              onChange={(e) => onVarChange(key, e.target.value)}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * Развёрнутый мини-макет РЕАЛЬНОГО shell'а приложения (toolbar + левый
 * сайдбар + браузерная область + карточка снизу) — в отличие от ThemeCard
 * (компактная карточка, силуэт по 10 переменным) здесь задействованы ВСЕ 19
 * переменных темы на заметных элементах, чтобы правка любого поля в форме
 * была сразу видна (аналог ThemePreviewMock из Skill-tree, другой shell).
 */
function ThemePreviewMock({ vars: v, label }: { vars: ThemeVars; label: string }): JSX.Element {
  return (
    <div className="theme-editor-mock" style={{ background: v.bg, color: v.text }}>
      <div className="theme-editor-mock-topbar" style={{ background: v['bg-panel'], borderBottom: `1px solid ${v.border}` }}>
        <span className="theme-editor-mock-brand">{label}</span>
        <span className="theme-editor-mock-btn" style={{ background: v.accent, color: v['accent-text'] }}>
          Import
        </span>
      </div>

      <div className="theme-editor-mock-body">
        <div className="theme-editor-mock-side" style={{ background: v['bg-panel'], borderRight: `1px solid ${v.border}` }}>
          <div style={{ color: v['text-dim'] }}>example.com</div>
          <div className="theme-editor-mock-row-hover" style={{ background: v.hover, color: v.text }}>
            Наведение
          </div>
          <div
            className="theme-editor-mock-row-active"
            style={{ background: v['accent-soft'], color: v.accent, borderLeft: `2px solid ${v.accent}` }}
          >
            Выбрано
          </div>
          <div style={{ color: v['text-faint'] }}>Едва заметно</div>
        </div>

        <div className="theme-editor-mock-graph" style={{ background: v['bg-canvas'] }}>
          <div className="theme-editor-mock-canvas-box" style={{ background: v.surface, border: `1px solid ${v['border-strong']}` }} />
        </div>
      </div>

      <div className="theme-editor-mock-card" style={{ background: v.surface, border: `1px solid ${v.border}`, boxShadow: v.shadow }}>
        <span className="theme-editor-mock-chip" style={{ background: v['surface-2'], color: v['text-dim'] }}>
          OK
        </span>
        <span style={{ color: v.warning }}>Warning</span>
        <span style={{ color: v.info }}>Info</span>
        <span style={{ color: v.success }}>Success</span>
        <span className="theme-editor-mock-danger" style={{ color: v.danger }}>
          Danger
        </span>
      </div>
    </div>
  )
}
