import { useEffect, useState } from 'react'
import { Monitor, Moon, Palette, RefreshCw, Settings, Sun } from 'lucide-react'
import { BUILTIN_THEMES, DEFAULT_THEME, Popover, Segmented, Switch } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { UpdateStatus } from '../../../shared/types'
import { ThemesGalleryModal } from './ThemesGalleryModal'
import { UpdateBadge } from './UpdateBadge'

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  { value: 'system', label: 'System', icon: <Monitor size={13} /> }
]

function updateStatusText(status: UpdateStatus | null): string {
  if (!status) return ''
  switch (status.state) {
    case 'checking':
      return 'Проверка обновлений…'
    case 'available':
      return `Найдена версия ${status.version ?? ''} — загружается…`
    case 'not-available':
      return 'У вас последняя версия.'
    case 'downloaded':
      return `Версия ${status.version ?? ''} загружена — перезапустите приложение.`
    case 'error':
      return status.message ?? 'Не удалось проверить обновления.'
    default:
      return ''
  }
}

interface Props {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
  themeSyncEnabled: boolean
  onThemeSyncEnabledChange: (enabled: boolean) => void
}

/**
 * Кнопка "Настройки", пришпиленная к низу сайдбара, + попап над ней —
 * портировано из .settings-anchor/.settings-toggle + SettingsPanel.tsx
 * Skill-tree, урезано до релевантных секций: "Внешний вид" (выбор темы,
 * открывает галерею, + Light/Dark/System — был в toolbar, теперь здесь, см.
 * docs/design-system.md §7) и "Обновления" (кнопка ручной проверки +
 * статус, тот же паттерн, что в Skill-tree, см. main/autoUpdater.ts —
 * плашка "готово к установке" (`UpdateBadge`) тоже здесь, но появляется
 * только когда обновление уже СКАЧАНО, независимо от ручной проверки).
 * Остальные секции Skill-tree (директории, шрифт, механика разблокировки)
 * нерелевантны этому приложению.
 */
export function SettingsPopover({
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange,
  themeSyncEnabled,
  onThemeSyncEnabledChange
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => window.api.onUpdateStatus(setUpdateStatus), [])

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
          <div className="settings-row">
            <span>Синхронизировать тему с Bridge Tools</span>
            <Switch checked={themeSyncEnabled} onChange={onThemeSyncEnabledChange} />
          </div>
        </div>

        <div className="settings-sep" />

        <div className="settings-section">
          <div className="settings-row">
            <span>Обновления</span>
            <button
              className="icon-btn xs"
              title="Проверить обновления"
              disabled={updateStatus?.state === 'checking'}
              onClick={() => window.api.checkForUpdate()}
            >
              <RefreshCw size={13} className={updateStatus?.state === 'checking' ? 'spin' : undefined} />
            </button>
          </div>
          {updateStatus && <p className="settings-update-status">{updateStatusText(updateStatus)}</p>}
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
