import { useEffect, useState } from 'react'
import { Wand2, X } from 'lucide-react'
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from '@web-to-figma/ui'
import type { ThemeDef } from '@web-to-figma/ui'
import { ThemeCard } from './ThemeCard'
import { ThemeEditorModal } from './ThemeEditorModal'
import { usePopoverVisibility } from '../hooks/usePopoverVisibility'

interface Props {
  themeId: string
  customThemes: ThemeDef[]
  onSelect: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
  onClose: () => void
}

/**
 * Модальное окно «Темы» — по центру экрана (не всплывающий попап у кнопки),
 * т.к. это выбор из галереи карточек. Портировано из ThemesPopup Skill-tree;
 * JSON-импорт/экспорт темы сознательно НЕ портирован в этой итерации (нужен
 * Electron dialog + fs-плечо только ради редкого сценария) — см.
 * docs/design-system.md §7, явно отложено, а не молча выброшено.
 */
export function ThemesGalleryModal({ themeId, customThemes, onSelect, onCustomThemesChange, onClose }: Props): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false)
  // Компонент существует в дереве, только пока модалка открыта (родитель
  // рендерит условно) — mount сам по себе И ЕСТЬ "open" для этого хука.
  usePopoverVisibility(true)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const activeTheme = [...BUILTIN_THEMES, ...customThemes].find((t) => t.id === themeId)

  function removeCustomTheme(id: string): void {
    onCustomThemesChange(customThemes.filter((t) => t.id !== id))
    if (themeId === id) onSelect(DEFAULT_THEME_ID)
  }

  function addCustomTheme(theme: ThemeDef): void {
    onCustomThemesChange([...customThemes, theme])
    onSelect(theme.id)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal themes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Темы</span>
          <div className="modal-head-actions">
            <button
              className="tb-btn theme-editor-btn"
              title="Создать тему на основе активной"
              onClick={() => setEditorOpen(true)}
            >
              <Wand2 size={14} /> Редактор темы
            </button>
            <button className="icon-btn" onClick={onClose} title="Закрыть">
              <X size={16} />
            </button>
          </div>
        </div>

        <label className="settings-label">Базовые</label>
        <div className="theme-grid">
          {BUILTIN_THEMES.map((t) => (
            <ThemeCard key={t.id} theme={t} active={themeId === t.id} onClick={() => onSelect(t.id)} />
          ))}
        </div>

        <label className="settings-label" style={{ marginTop: 18 }}>
          Свои
        </label>
        {customThemes.length === 0 ? (
          <div className="theme-empty">Пока нет своих тем — создайте в редакторе темы</div>
        ) : (
          <div className="theme-grid">
            {customThemes.map((t) => (
              <ThemeCard
                key={t.id}
                theme={t}
                active={themeId === t.id}
                onClick={() => onSelect(t.id)}
                onRemove={() => removeCustomTheme(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {editorOpen && activeTheme && (
        <ThemeEditorModal baseTheme={activeTheme} onClose={() => setEditorOpen(false)} onSave={addCustomTheme} />
      )}
    </div>
  )
}
