import { useEffect, useState } from 'react'
import type { BrowserState } from '../../../shared/types'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserViewport } from './BrowserViewport'
import { PickerFloatBar } from './PickerFloatBar'

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  faviconUrl: null,
  loadError: null
}

export function BrowserPane(): JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)

  useEffect(() => {
    window.api.browserGetState().then((s) => s && setState(s))
    return window.api.onBrowserState(setState)
  }, [])

  return (
    <>
      <BrowserToolbar
        state={state}
        onNavigate={(input) => window.api.browserNavigate(input)}
        onBack={() => window.api.browserBack()}
        onForward={() => window.api.browserForward()}
        onReload={() => window.api.browserReload()}
        onStop={() => window.api.browserStop()}
      />
      <div className="browser-viewport-wrap">
        <BrowserViewport />
        <PickerFloatBar />
      </div>
    </>
  )
}
