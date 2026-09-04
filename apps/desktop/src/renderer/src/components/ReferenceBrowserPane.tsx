import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { AppSettings, BrowserState, TabsSnapshot } from '../../../shared/types'
import { useEdgeReveal } from '../hooks/useEdgeReveal'
import { BrowserTabBar } from './BrowserTabBar'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserViewport } from './BrowserViewport'

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
 * Встроенный референс-браузер (по коррекции пользователя — НЕ переход на
 * вкладку "Браузер", отдельный вьюпорт прямо на детальной странице
 * референс-сайта, см. ReferencesView.tsx ReferenceSiteDetail) — тот же вид,
 * что обычный браузер (вкладки + адресная строка ведут себя как всегда), но
 * СИЛЬНО урезан: без BottomPanel (Ассеты/Компоненты) — тот тут не нужен и
 * никогда не запрашивался. Указывает на ВТОРОЙ, независимый
 * BrowserController (см. main/index.ts referenceBrowserController), поэтому
 * вкладки/навигация здесь совершенно не пересекаются с тем, что открыто на
 * основной вкладке "Браузер".
 *
 * Полноэкранный верх — теперь ТОЧНО тот же паттерн, что BrowserPane.tsx (по
 * прямой жалобе пользователя "сделал неправильно, посмотри как в основном
 * браузере"): push И float, оба режима, а не только push, как было раньше.
 * В push — адресная строка сворачивается инлайн (hover-reveal полоска +
 * pin), строка вкладок остаётся всегда видимой. В float — ВЕСЬ верх (вкладки
 * + адресная строка) уходит в плавающий overlay-слой 'panel-top' (см.
 * main/index.ts repositionPanelOverlay, BrowserTopBarOverlayContent.tsx —
 * тот теперь сам решает, каким браузером управлять, смотря на
 * onReferenceSessionState), здесь остаётся только тонкая полоска реvила.
 * Pin-канал — 'reference-top', НЕ 'top' (тот уже занят основным браузером,
 * см. App.tsx Workspace topPinned) — иначе закрепление тут одновременно
 * закрепляло бы (невидимый в этот момент) верх основного браузера, живой
 * баг обнаружился бы при следующем переключении на вкладку "Браузер".
 */
interface Props {
  distractionFree: boolean
  onToggleDistractionFree: () => void
  fullscreenMode: AppSettings['fullscreenMode']
}

export function ReferenceBrowserPane({ distractionFree, onToggleDistractionFree, fullscreenMode }: Props): JSX.Element {
  const [tabsState, setTabsState] = useState<TabsSnapshot>(EMPTY_TABS)
  const navReveal = useEdgeReveal()
  const [topPinned, setTopPinned] = useState(false)
  useEffect(
    () =>
      window.api.onPopoverAction((action) => {
        if (action.type !== 'pin-panel') return
        const { side, pinned } = action.payload as { side: string; pinned: boolean }
        if (side === 'reference-top') setTopPinned(pinned)
      }),
    []
  )
  const isTopFloat = distractionFree && fullscreenMode === 'float' && !topPinned
  const navVisible = topPinned || !distractionFree || navReveal.revealed
  const topStripHandlers = isTopFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'top', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'top', entering: false })
      }
    : { onMouseEnter: navReveal.onMouseEnter, onMouseLeave: navReveal.onMouseLeave }

  useEffect(() => {
    window.api.referenceBrowserGetTabs().then(setTabsState)
    return window.api.onReferenceBrowserTabs(setTabsState)
  }, [])

  // НЕ прячем WebContentsView на unmount (никакого useEffect-cleanup с
  // referenceBrowserSetHidden(true) здесь) — тот же класс живого бага, что
  // уже ловили с referenceSessionEnd(): под React StrictMode (dev) эффекты
  // с cleanup синтетически прогоняются mount→cleanup→mount уже на первом
  // маунте, так что setHidden(true) в cleanup срабатывал СРАЗУ после
  // открытия — BrowserController.hidden после этого навсегда остаётся true
  // (ничто больше не сбрасывает его в false), и все ПОСЛЕДУЮЩИЕ реальные
  // bounds от BrowserViewport молча игнорируются (см. BrowserController.
  // setBounds: `if (!this.hidden) ...`) — сайт РЕАЛЬНО грузился (title/url
  // обновлялись), просто нативный слой оставался нулевого размера навсегда.
  // Живой баг, поймал пользователь ("сайты не загружаются", хотя на самом
  // деле не отображались). Скрытие теперь целиком на main-стороне — см.
  // main/index.ts reference:session-end (единственное место, которое зовёт
  // setHidden, привязано к реальному пользовательскому действию, а не к
  // React unmount-таймингу).

  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? EMPTY_STATE

  return (
    <div className="col reference-browser-pane">
      {isTopFloat ? (
        <div className="edge-reveal-strip edge-reveal-strip-top" {...topStripHandlers} />
      ) : (
        <>
          <BrowserTabBar
            tabs={tabsState.tabs}
            activeTabId={tabsState.activeTabId}
            onSwitch={(id) => window.api.referenceBrowserSwitchTab(id)}
            onClose={(id) => window.api.referenceBrowserCloseTab(id)}
            onNewTab={() => window.api.referenceBrowserNewTab()}
            distractionFree={distractionFree}
            onToggleDistractionFree={onToggleDistractionFree}
            pinAction={
              distractionFree && (
                <IconButton
                  active={topPinned}
                  onClick={() => void window.api.popoverAction({ type: 'pin-panel', payload: { side: 'reference-top', pinned: !topPinned } })}
                  title={topPinned ? 'Открепить панель' : 'Закрепить панель'}
                >
                  <Pin size={13} fill={topPinned ? 'currentColor' : 'none'} />
                </IconButton>
              )
            }
          />
          {navVisible ? (
            <div onMouseEnter={navReveal.onMouseEnter} onMouseLeave={navReveal.onMouseLeave}>
              <BrowserToolbar
                state={activeTab}
                onNavigate={(input) => window.api.referenceBrowserNavigate(input)}
                onBack={() => window.api.referenceBrowserBack()}
                onForward={() => window.api.referenceBrowserForward()}
                onReload={() => window.api.referenceBrowserReload()}
                onStop={() => window.api.referenceBrowserStop()}
              />
            </div>
          ) : (
            <div className="edge-reveal-strip edge-reveal-strip-top" onMouseEnter={navReveal.onMouseEnter} onMouseLeave={navReveal.onMouseLeave} />
          )}
        </>
      )}
      <div className="reference-browser-viewport-wrap">
        <BrowserViewport onBounds={(b) => window.api.referenceBrowserSetBounds(b)} />
      </div>
    </div>
  )
}
