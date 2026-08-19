import { useEffect, useState } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { clamp, isValidThemeDef, ThemeProvider, useResizer } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { BridgePopover } from './components/BridgePopover'
import { BrowserPane } from './components/BrowserPane'
import { InspectorPanel } from './components/InspectorPanel'
import { LeftSidebar } from './components/LeftSidebar'

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
      />
    </ThemeProvider>
  )
}

function Shell({
  settings,
  onThemeModeChange,
  onThemeIdChange,
  onCustomThemesChange
}: {
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
}): JSX.Element {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

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
      </div>
      <Workspace
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        settings={settings}
        onThemeModeChange={onThemeModeChange}
        onThemeIdChange={onThemeIdChange}
        onCustomThemesChange={onCustomThemesChange}
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
  onCustomThemesChange
}: {
  leftOpen: boolean
  rightOpen: boolean
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
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
