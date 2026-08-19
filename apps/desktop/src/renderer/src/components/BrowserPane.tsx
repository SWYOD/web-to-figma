import { useEffect, useState } from 'react'
import type { BrowserState, TabsSnapshot } from '../../../shared/types'
import { BrowserTabBar } from './BrowserTabBar'
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

const EMPTY_TABS: TabsSnapshot = { tabs: [], activeTabId: null }

export function BrowserPane(): JSX.Element {
  const [tabsState, setTabsState] = useState<TabsSnapshot>(EMPTY_TABS)

  useEffect(() => {
    window.api.browserGetTabs().then(setTabsState)
    return window.api.onTabsState(setTabsState)
  }, [])

  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? EMPTY_STATE

  return (
    <>
      <BrowserTabBar
        tabs={tabsState.tabs}
        activeTabId={tabsState.activeTabId}
        onSwitch={(id) => window.api.browserSwitchTab(id)}
        onClose={(id) => window.api.browserCloseTab(id)}
        onNewTab={() => window.api.browserNewTab()}
      />
      <BrowserToolbar
        state={activeTab}
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
