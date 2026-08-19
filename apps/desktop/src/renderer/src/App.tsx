import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Segmented, ThemeProvider, clamp, useResizer } from '@web-to-figma/ui'
import type { ThemeMode } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { BridgePopover } from './components/BridgePopover'
import { BrowserPane } from './components/BrowserPane'
import { InspectorPanel } from './components/InspectorPanel'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  { value: 'system', label: 'System', icon: <Monitor size={13} /> }
]

export default function App(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  if (!settings) return null

  const setThemeMode = (themeMode: ThemeMode): void => {
    const next = { ...settings, themeMode }
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <ThemeProvider mode={settings.themeMode} onModeChange={setThemeMode}>
      <Shell themeMode={settings.themeMode} onThemeModeChange={setThemeMode} />
    </ThemeProvider>
  )
}

function Shell({
  themeMode,
  onThemeModeChange
}: {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}): JSX.Element {
  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-left">
          <span className="brand">Web → Figma</span>
        </div>
        <div className="toolbar-right">
          <Segmented value={themeMode} options={THEME_OPTIONS} onChange={onThemeModeChange} />
          <div className="tb-sep" />
          <BridgePopover />
        </div>
      </div>
      <Workspace />
    </div>
  )
}

function Workspace(): JSX.Element {
  const [rightWidth, setRightWidth] = useState(360)
  const resizer = useResizer((dx) => setRightWidth((w) => clamp(w - dx, 260, 560)))

  return (
    <div className="workspace">
      <div className="col center-col">
        <BrowserPane />
      </div>
      <div className="resizer" {...resizer} />
      <div className="col" style={{ width: rightWidth }}>
        <InspectorPanel />
      </div>
    </div>
  )
}
