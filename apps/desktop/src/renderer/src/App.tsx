import { useEffect, useRef, useState } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { clamp, effectiveVariant, isValidThemeDef, ThemeProvider, useResizer, useTheme } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { AppSettings, ImportProgressEvent } from '../../shared/types'
import { BridgePopover } from './components/BridgePopover'
import { BrowserPane } from './components/BrowserPane'
import { InspectorPanel } from './components/InspectorPanel'
import { LeftSidebar } from './components/LeftSidebar'
import { VersionBadge } from './components/VersionBadge'

export default function App(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      // Защита от повреждённого/устаревшего settings.json (см. isValidThemeDef) —
      // мусорная запись в customThemes не должна ронять резолв активной темы.
      setSettings({ ...s, customThemes: s.customThemes.filter(isValidThemeDef) })
    })
  }, [])

  if (!settings) return null

  const updateSettings = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <ThemeProvider
      mode={settings.themeMode}
      onModeChange={(themeMode) => updateSettings({ themeMode })}
      themeId={settings.themeId}
      customThemes={settings.customThemes}
      onThemeIdChange={(themeId) => updateSettings({ themeId })}
    >
      <Shell
        settings={settings}
        onThemeModeChange={(themeMode) => updateSettings({ themeMode })}
        onThemeIdChange={(themeId) => updateSettings({ themeId })}
        onCustomThemesChange={(customThemes) => updateSettings({ customThemes })}
        onThemeSyncEnabledChange={(themeSyncEnabled) => updateSettings({ themeSyncEnabled })}
      />
    </ThemeProvider>
  )
}

function Shell({
  settings,
  onThemeModeChange,
  onThemeIdChange,
  onCustomThemesChange,
  onThemeSyncEnabledChange
}: {
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
  onThemeSyncEnabledChange: (enabled: boolean) => void
}): JSX.Element {
  const { resolvedMode, theme } = useTheme()
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null)
  const progressHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!settings.themeSyncEnabled) return
    void window.api.syncPluginTheme({
      themeId: theme.id,
      mode: resolvedMode,
      vars: effectiveVariant(theme, resolvedMode)
    })
  }, [resolvedMode, theme, settings.themeSyncEnabled])

  useEffect(() => {
    const unsubscribe = window.api.onImportProgress((event) => {
      if (progressHideTimer.current) clearTimeout(progressHideTimer.current)
      setImportProgress(event)
      if (event.state !== 'running') {
        progressHideTimer.current = setTimeout(() => setImportProgress(null), 2200)
      }
    })
    return () => {
      unsubscribe()
      if (progressHideTimer.current) clearTimeout(progressHideTimer.current)
    }
  }, [])

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-left">
          <button
            className={`icon-btn${leftOpen ? ' active' : ''}`}
            title="Левая панель"
            onClick={() => setLeftOpen((v) => !v)}
          >
            <PanelLeft size={17} />
          </button>
          <span className="brand">Web To Figma</span>
          <VersionBadge />
        </div>
        <div className="toolbar-right">
          <BridgePopover />
          <div className="tb-sep" />
          <button
            className={`icon-btn${rightOpen ? ' active' : ''}`}
            title="Правая панель"
            onClick={() => setRightOpen((v) => !v)}
          >
            <PanelRight size={17} />
          </button>
        </div>
        {importProgress && (
          <div className={`import-progress-ui ${importProgress.state}`} role="status" aria-live="polite">
            <div className="import-progress-copy">
              <span>{importProgress.label}</span>
              {importProgress.detail && <span className="import-progress-detail">{importProgress.detail}</span>}
            </div>
            <div className="import-progress-track">
              <div className="import-progress-fill" style={{ width: `${Math.round(importProgress.progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      <Workspace
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        settings={settings}
        onThemeModeChange={onThemeModeChange}
        onThemeIdChange={onThemeIdChange}
        onCustomThemesChange={onCustomThemesChange}
        onThemeSyncEnabledChange={onThemeSyncEnabledChange}
      />
    </div>
  )
}

function Workspace({
  leftOpen,
  rightOpen,
  settings,
  onThemeModeChange,
  onThemeIdChange,
  onCustomThemesChange,
  onThemeSyncEnabledChange
}: {
  leftOpen: boolean
  rightOpen: boolean
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
  onThemeSyncEnabledChange: (enabled: boolean) => void
}): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(260)
  const leftResizer = useResizer((dx) => setLeftWidth((w) => clamp(w + dx, 200, 480)))
  const [rightWidth, setRightWidth] = useState(360)
  const rightResizer = useResizer((dx) => setRightWidth((w) => clamp(w - dx, 260, 560)))

  return (
    <div className="workspace">
      {leftOpen && (
        <>
          <div className="col" style={{ width: leftWidth }}>
            <LeftSidebar
              themeMode={settings.themeMode}
              onThemeModeChange={onThemeModeChange}
              themeId={settings.themeId}
              customThemes={settings.customThemes}
              onThemeIdChange={onThemeIdChange}
              onCustomThemesChange={onCustomThemesChange}
              themeSyncEnabled={settings.themeSyncEnabled}
              onThemeSyncEnabledChange={onThemeSyncEnabledChange}
            />
          </div>
          <div className="resizer" {...leftResizer} />
        </>
      )}
      <div className="col center-col">
        <BrowserPane />
      </div>
      {rightOpen && (
        <>
          <div className="resizer" {...rightResizer} />
          <div className="col" style={{ width: rightWidth }}>
            <InspectorPanel />
          </div>
        </>
      )}
    </div>
  )
}
