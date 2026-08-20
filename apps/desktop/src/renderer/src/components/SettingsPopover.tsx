import { useState } from 'react'
import { Monitor, Moon, Palette, Settings, Sun } from 'lucide-react'
import { BUILTIN_THEMES, DEFAULT_THEME, Popover, Segmented } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import { ThemesGalleryModal } from './ThemesGalleryModal'
import { UpdateBadge } from './UpdateBadge'

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  { value: 'system', label: 'System', icon: <Monitor size={13} /> }
]

interface Props {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
}

/**
 * Кнопка "Настройки", пришпиленная к низу сайдбара, + попап над ней —
 * портировано из .settings-anchor/.settings-toggle + SettingsPanel.tsx
 * Skill-tree, урезано до единственной релевантной секции ("Внешний вид"):
 * выбор темы (открывает галерею) + Light/Dark/System (был в toolbar, теперь
 * здесь — см. docs/design-system.md §7). Остальные секции Skill-tree
 * (директории, шрифт, механика разблокировки) нерелевантны — плашка
 * обновлений (`UpdateBadge`), наоборот, теперь есть и здесь, тем же
 * паттерном, что в Skill-tree (см. main/autoUpdater.ts).
 */
export function SettingsPopover({
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const activeTheme = [...BUILTIN_THEMES, ...customThemes].find((t) => t.id === themeId) ?? DEFAULT_THEME

  return (
    <div className="settings-anchor">
      <UpdateBadge />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="up-stretch"
        anchor={
          <button className="settings-toggle" onClick={() => setOpen((v) => !v)}>
            <Settings size={15} /> Настройки
          </button>
        }
      >
        <div className="settings-section">
          <span className="settings-label">Внешний вид</span>
          <button className="settings-row settings-row-btn" onClick={() => setGalleryOpen(true)}>
            <span>Темы</span>
            <span className="settings-row-value">
              <Palette size={13} /> {activeTheme.name}
            </span>
          </button>
          <Segmented value={themeMode} options={THEME_MODE_OPTIONS} onChange={onThemeModeChange} />
        </div>
      </Popover>

      {galleryOpen && (
        <ThemesGalleryModal
          themeId={themeId}
          customThemes={customThemes}
          onSelect={onThemeIdChange}
          onCustomThemesChange={onCustomThemesChange}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  )
}
