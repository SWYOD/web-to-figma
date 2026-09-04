import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { BrowserState, TabsSnapshot } from '../../../shared/types'
import { BrowserTabBar } from './BrowserTabBar'
import { BrowserToolbar } from './BrowserToolbar'

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

/**
 * Содержимое плавающей верхней панели браузера ('panel-top' слой, см.
 * main/index.ts repositionPanelOverlay) — вкладки + адресная строка, по
 * запросу пользователя: "в float режиме вкладки браузера тоже пусть
 * скрываются и отображаются тоже флоат, чтобы был как бы полный экран
 * сайта". Живёт в OTDEL'НОМ overlay-рендерере (см. PanelOverlayRoot.tsx), не
 * в главном окне — подписывается на состояние вкладок само (тот же
 * поднабор, что и BrowserPane.tsx там), у overlay-рендерера тот же доступ к
 * window.api, что и у главного окна.
 *
 * Пока виден встроенный референс-браузер, а не основной (см.
 * window.api.onReferenceBrowserVisible / main/index.ts referenceBrowserVisible
 * докстринг — шире просто активной сессии сбора, покрывает и "поиск сайта"
 * до старта сбора) — эта панель должна управлять ИМ, а не всегда основным,
 * иначе в float-режиме на вкладке "Референсы" плавающая панель молча
 * дёргала бы совсем другой (невидимый) браузер — живой баг, поймал
 * пользователь ("режим выбран поверх, а он почему-то раздвигает").
 *
 * Полноэкранный переключатель в BrowserTabBar всегда в состоянии "выключить"
 * (эта панель показывается ТОЛЬКО пока distraction-free уже включён) — клик
 * шлёт `popoverAction` главному окну (см. App.tsx onPopoverAction), тот же
 * generic bounce-back, что уже использует AddToProjectButton для
 * CreateProjectModal — своего React state с `distractionFree` тут нет, он
 * живёт в App.tsx главного окна.
 */
export function BrowserTopBarOverlayContent(): JSX.Element {
  const [tabsState, setTabsState] = useState<TabsSnapshot>(EMPTY_TABS)
  const [referenceVisible, setReferenceVisible] = useState(false)

  useEffect(() => {
    window.api.referenceGetBrowserVisible().then(setReferenceVisible)
    return window.api.onReferenceBrowserVisible(setReferenceVisible)
  }, [])

  useEffect(() => {
    const getTabs = referenceVisible ? window.api.referenceBrowserGetTabs : window.api.browserGetTabs
    const onTabs = referenceVisible ? window.api.onReferenceBrowserTabs : window.api.onTabsState
    getTabs().then(setTabsState)
    return onTabs(setTabsState)
  }, [referenceVisible])

  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? EMPTY_STATE

  return (
    <div className="col browser-top-overlay-col">
      <BrowserTabBar
        tabs={tabsState.tabs}
        activeTabId={tabsState.activeTabId}
        onSwitch={(id) => (referenceVisible ? window.api.referenceBrowserSwitchTab(id) : window.api.browserSwitchTab(id))}
        onClose={(id) => (referenceVisible ? window.api.referenceBrowserCloseTab(id) : window.api.browserCloseTab(id))}
        onNewTab={() => (referenceVisible ? window.api.referenceBrowserNewTab() : window.api.browserNewTab())}
        distractionFree
        onToggleDistractionFree={() => void window.api.popoverAction({ type: 'exit-distraction-free' })}
        pinAction={
          <IconButton
            title="Закрепить панель"
            onClick={() =>
              void window.api.popoverAction({
                type: 'pin-panel',
                payload: { side: referenceVisible ? 'reference-top' : 'top', pinned: true }
              })
            }
          >
            <Pin size={13} />
          </IconButton>
        }
      />
      <BrowserToolbar
        state={activeTab}
        onNavigate={(input) => (referenceVisible ? window.api.referenceBrowserNavigate(input) : window.api.browserNavigate(input))}
        onBack={() => (referenceVisible ? window.api.referenceBrowserBack() : window.api.browserBack())}
        onForward={() => (referenceVisible ? window.api.referenceBrowserForward() : window.api.browserForward())}
        onReload={() => (referenceVisible ? window.api.referenceBrowserReload() : window.api.browserReload())}
        onStop={() => (referenceVisible ? window.api.referenceBrowserStop() : window.api.browserStop())}
      />
    </div>
  )
}
