import { useEffect, useRef, useState } from 'react'
import { Pin } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
import type { AppSettings, AssetScanResult, BrowserState, ComponentScanResult, ScannedAsset, ScannedComponent, TabsSnapshot } from '../../../shared/types'
import { BottomPanel } from './BottomPanel'
import { BrowserTabBar } from './BrowserTabBar'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserViewport } from './BrowserViewport'
import { useEdgeReveal } from '../hooks/useEdgeReveal'

/** Верхняя граница на СУММУ ассетов по всем накопленным страницам одного
 *  домена (по жалобе пользователя — "если ассетов много, панель тормозит";
 *  без потолка автоскан на каждой странице копит бесконечно за долгую сессию
 *  на одном сайте). При превышении роняются СТАРЕЙШИЕ партии целиком (см.
 *  capBatches) — партия показана целиком или не показана вовсе, а не
 *  наполовину, иначе подпись "с какой страницы" стала бы нечестной. */
const MAX_TOTAL_ASSETS_PER_DOMAIN = 500

// Стартовая страница — свой data: URL (см. main/startPage.ts), не настоящий
// сайт: сканировать её нечего (по живому багу, поймал пользователь — иконка
// лупы в её собственной строке поиска попадала в автоскан новой вкладки как
// обычный "сайт", с пустым pageTitle → подпись партии (AssetsPanel.tsx
// PageBatch) падала назад на СЫРОЙ нерасшифрованный data: URL — длиннющая
// строка ломала раскладку панели).
const isStartPage = (url: string): boolean => url.startsWith('data:text/html')

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

/** Один скан одной КОНКРЕТНОЙ страницы внутри вкладки — только НОВЫЕ ассеты,
 *  которых не было в предыдущих сканах этой же вкладки (см. scanActiveTab).
 *  Отдельная запись на каждый уникальный URL, чтобы в панели можно было
 *  подписать "откуда" пришла каждая партия (по запросу пользователя). */
export interface PageAssetBatch {
  pageUrl: string
  pageTitle: string
  assets: ScannedAsset[]
}

/** Скан ассетов одной вкладки — аккумулируется по мере навигации по разным
 *  страницам ОДНОГО ДОМЕНА в этой вкладке (по запросу пользователя: раньше
 *  повторный скан после перехода на другую страницу того же сайта полностью
 *  затирал предыдущий результат). `domain` — хост, для которого накоплены
 *  `batches`: переход на ДРУГОЙ домен в этой же вкладке начинает список
 *  заново (см. scanActiveTab) — иначе, например, иконки википедии остаются
 *  висеть в панели после перехода на совершенно другой сайт, что и получилось
 *  в первой версии этой фичи, где аккумуляция была привязана только к
 *  `tabId`, без учёта домена. `tabTitle` — заголовок последней
 *  отсканированной страницы, для заголовка всей группы; per-page разбивка —
 *  в `batches`. */
export interface TabAssetScan {
  tabId: string
  tabTitle: string
  domain: string
  batches: PageAssetBatch[]
  truncated: boolean
}

export interface TabComponentScan {
  tabId: string
  tabTitle: string
  pageUrl: string
  components: ScannedComponent[]
  truncated: boolean
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function capBatches(batches: PageAssetBatch[], maxTotal: number): { batches: PageAssetBatch[]; capped: boolean } {
  const total = batches.reduce((sum, b) => sum + b.assets.length, 0)
  if (total <= maxTotal) return { batches, capped: false }
  let remaining = total
  let dropFrom = 0
  while (dropFrom < batches.length && remaining > maxTotal) {
    remaining -= batches[dropFrom]!.assets.length
    dropFrom++
  }
  return { batches: batches.slice(dropFrom), capped: true }
}

interface Props {
  distractionFree: boolean
  onToggleDistractionFree: () => void
  fullscreenMode: AppSettings['fullscreenMode']
  /** Закрепление верхней панели (см. App.tsx Workspace leftPinned/rightPinned
   *  — тот же паттерн, "в любом полноэкранном режиме"). В float-режиме
   *  форсит инлайн-показ вкладок+тулбара вместо плавающего слоя (см.
   *  isTopFloat ниже); в push-режиме держит адресную строку видимой без
   *  наведения — единая механика для обоих случаев через navVisible. */
  topPinned: boolean
  onToggleTopPinned: () => void
}

export function BrowserPane({ distractionFree, onToggleDistractionFree, fullscreenMode, topPinned, onToggleTopPinned }: Props): JSX.Element {
  const [tabsState, setTabsState] = useState<TabsSnapshot>(EMPTY_TABS)
  const [scans, setScans] = useState<Record<string, TabAssetScan>>({})
  const [componentScans, setComponentScans] = useState<Record<string, TabComponentScan>>({})
  const [scanningTabId, setScanningTabId] = useState<string | null>(null)
  const [bottomMaximized, setBottomMaximized] = useState(false)
  const tabsStateRef = useRef(tabsState)
  tabsStateRef.current = tabsState
  // Distraction-free (см. App.tsx) — по запросу пользователя "верх браузера
  // тоже надо скрывающимся, и нижнюю панель с ассетами/компонентами":
  // BrowserToolbar (навигация+адресная строка) и BottomPanel сворачиваются
  // так же, как сайдбар/inspector (см. useEdgeReveal докстринг). В push-режиме
  // BrowserTabBar (вкладки + сам переключатель режима) остаётся видимой
  // всегда, иначе выключить режим было бы нечем — но в float-режиме (по
  // запросу пользователя, "чтобы был как бы полный экран сайта") вкладки
  // ТОЖЕ сворачиваются, вместе с адресной строкой ОДНОЙ группой, и рисуются
  // НАД страницей в overlay-слое 'panel-top' (см. BrowserTopBarOverlayContent.tsx),
  // а не раздвигают вьюпорт при показе — тот же hover-gate механизм, что и
  // у left/right панелей (см. main/index.ts createHoverGate).
  const isTopFloat = distractionFree && fullscreenMode === 'float' && !topPinned
  const navReveal = useEdgeReveal()
  const bottomReveal = useEdgeReveal()
  const navVisible = topPinned || !distractionFree || navReveal.revealed
  const bottomVisible = !distractionFree || bottomReveal.revealed
  const topPinAction = distractionFree && (
    <IconButton active={topPinned} onClick={onToggleTopPinned} title={topPinned ? 'Открепить панель' : 'Закрепить панель'}>
      <Pin size={14} fill={topPinned ? 'currentColor' : 'none'} />
    </IconButton>
  )
  const topStripHandlers = isTopFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'top', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'top', entering: false })
      }
    : { onMouseEnter: navReveal.onMouseEnter, onMouseLeave: navReveal.onMouseLeave }

  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? EMPTY_STATE

  const scanActiveTab = async (): Promise<void> => {
    const { activeTabId, tabs } = tabsStateRef.current
    if (!activeTabId) return
    const activeTabState = tabs.find((t) => t.id === activeTabId)
    const url = activeTabState?.url ?? ''
    if (isStartPage(url)) return
    const title = activeTabState?.title || url
    const domain = hostFromUrl(url)
    setScanningTabId(activeTabId)
    try {
      // Миниатюры растровых ассетов уже готовы в `result` — их генерирует
      // main-процесс через sharp (см. assetScanner.ts), не рендерер: раньше
      // здесь был `new Image()` + canvas на КАЖДУЮ картинку, синхронно
      // блокировавший UI-поток при накоплении десятков/сотен ассетов (живой
      // баг, жалоба пользователя на многосекундное подвисание панели).
      const result: AssetScanResult = await window.api.assetsScan()
      const componentResult: ComponentScanResult = await window.api.componentsScan()

      setScans((prev) => {
        const existing = prev[activeTabId]
        // Другой домен в той же вкладке — не накопление, а свежий старт: не
        // сравниваем на дедуп со старыми ассетами чужого сайта и не держим их
        // партии в списке (см. докстринг TabAssetScan.domain).
        const sameDomain = existing !== undefined && existing.domain === domain
        const priorBatches = sameDomain ? existing.batches : []
        // Дедуп по содержимому (data: URL), не по asset.id — тот нумеруется
        // заново в КАЖДОМ скане (asset-1, asset-2…), поэтому не годится как
        // устойчивый ключ "уже видели" между разными сканами одной вкладки.
        // Фреш из `prev` (не из snapshot до await) — на случай гонки с другим
        // сканом этой же вкладки, завершившимся, пока этот скан ещё шёл.
        const seen = new Set(priorBatches.flatMap((b) => b.assets.map((a) => a.data)))
        const newAssets = result.assets.filter((a) => !seen.has(a.data))

        let batches = priorBatches
        if (newAssets.length > 0) {
          const existingBatchIndex = priorBatches.findIndex((b) => b.pageUrl === url)
          if (existingBatchIndex === -1) {
            batches = [...priorBatches, { pageUrl: url, pageTitle: title, assets: newAssets }]
          } else {
            batches = priorBatches.map((b, i) => (i === existingBatchIndex ? { ...b, assets: [...b.assets, ...newAssets] } : b))
          }
        }

        const { batches: cappedBatches, capped } = capBatches(batches, MAX_TOTAL_ASSETS_PER_DOMAIN)
        const truncated = (sameDomain ? result.truncated || existing.truncated : result.truncated) || capped
        return {
          ...prev,
          [activeTabId]: { tabId: activeTabId, tabTitle: title, domain, batches: cappedBatches, truncated }
        }
      })
      setComponentScans((prev) => ({
        ...prev,
        [activeTabId]: {
          tabId: activeTabId,
          tabTitle: title,
          pageUrl: url,
          components: componentResult.components,
          truncated: componentResult.truncated
        }
      }))
    } finally {
      setScanningTabId((id) => (id === activeTabId ? null : id))
    }
  }

  // Автоскан при загрузке страницы (по запросу пользователя) — срабатывает
  // на переходе isLoading true→false У ТОЙ ЖЕ вкладки, что грузилась на
  // предыдущем сообщении; проверка "та же вкладка" не даёт случайно
  // отсканировать просто от переключения на уже загруженную вкладку.
  //
  // ВАЖНО: слежение идёт ПО КАЖДОМУ входящему IPC-сообщению `browser:tabs`
  // внутри самого `onTabsState`-колбэка, а не через `useEffect` от уже
  // отрендеренных `tabsState`/`activeTab` — на быстрой загрузке (маленькая
  // страница, из кэша) main-процесс шлёт `isLoading:true` и следом почти
  // сразу `isLoading:false`; React 18 может смёрджить оба setState в один
  // рендер, и тогда промежуточное значение `true` никогда не видно снаружи —
  // эффект по `activeTab.isLoading` эту связку молча пропускал (живой баг,
  // пойманный поштучным опросом browserGetTabs во время навигации). Здесь же
  // обрабатывается каждое сообщение по отдельности, до всякого батчинга.
  const loadTrackRef = useRef<{ tabId: string | null; isLoading: boolean }>({ tabId: null, isLoading: false })
  useEffect(() => {
    const handleSnapshot = (snapshot: TabsSnapshot): void => {
      tabsStateRef.current = snapshot
      setTabsState(snapshot)
      const active = snapshot.tabs.find((t) => t.id === snapshot.activeTabId)
      const prev = loadTrackRef.current
      const finishedLoading = prev.tabId === snapshot.activeTabId && prev.isLoading && active !== undefined && !active.isLoading
      loadTrackRef.current = { tabId: snapshot.activeTabId, isLoading: active?.isLoading ?? false }
      if (finishedLoading) scanActiveTab()
    }
    window.api.browserGetTabs().then(handleSnapshot)
    return window.api.onTabsState(handleSnapshot)
  }, [])

  // Offscreen renderer присылает превью постепенно: распознавание и панель не
  // ждут загрузки второй копии страницы, а карточки сами заполняются картинками.
  useEffect(
    () =>
      window.api.onComponentPreviewReady((event) => {
        setComponentScans((prev) => {
          const scan = prev[event.tabId]
          if (!scan || scan.pageUrl !== event.pageUrl) return prev
          let changed = false
          const components = scan.components.map((component) => {
            if (component.selector !== event.selector || component.thumbnail === event.thumbnail) return component
            changed = true
            return { ...component, thumbnail: event.thumbnail }
          })
          return changed ? { ...prev, [event.tabId]: { ...scan, components } } : prev
        })
      }),
    []
  )

  // Вкладка закрылась — её скан больше не за чем показывать (страницы уже нет).
  useEffect(() => {
    const openIds = new Set(tabsState.tabs.map((t) => t.id))
    setScans((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([tabId]) => openIds.has(tabId)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
    setComponentScans((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([tabId]) => openIds.has(tabId)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [tabsState.tabs])

  return (
    <>
      {isTopFloat ? (
        <div className="edge-reveal-strip edge-reveal-strip-top" {...topStripHandlers} />
      ) : (
        <>
          <BrowserTabBar
            tabs={tabsState.tabs}
            activeTabId={tabsState.activeTabId}
            onSwitch={(id) => window.api.browserSwitchTab(id)}
            onClose={(id) => window.api.browserCloseTab(id)}
            onNewTab={() => window.api.browserNewTab()}
            distractionFree={distractionFree}
            onToggleDistractionFree={onToggleDistractionFree}
            pinAction={topPinAction}
          />
          {navVisible ? (
            <div onMouseEnter={navReveal.onMouseEnter} onMouseLeave={navReveal.onMouseLeave}>
              <BrowserToolbar
                state={activeTab}
                onNavigate={(input) => window.api.browserNavigate(input)}
                onBack={() => window.api.browserBack()}
                onForward={() => window.api.browserForward()}
                onReload={() => window.api.browserReload()}
                onStop={() => window.api.browserStop()}
              />
            </div>
          ) : (
            <div className="edge-reveal-strip edge-reveal-strip-top" {...topStripHandlers} />
          )}
        </>
      )}
      {/* Явные flex-значения, а не полагаться на авто-basis: у обёртки вьюпорта
          нет обычного контента (BrowserViewport — position:absolute, дырка
          под нативный слой), поэтому "flex:1 1 auto" при maximized панели
          снизу не гарантированно схлопнул бы вьюпорт до нуля — авто-basis без
          in-flow контента считает место непредсказуемо. Явный 0 0 0px убирает
          неоднозначность: реальный нативный WebContentsView скрывается тем же
          способом, что и BrowserController.setHidden() — через нулевые bounds,
          которые ResizeObserver в BrowserViewport.tsx вычислит сам из схлопнутого
          div. Плавающий тулбар (pick/import/apply-to-selection) больше не
          рендерится здесь — он постоянно живёт в overlay-рендерере поверх
          браузера (см. OverlayRoot.tsx), браузер теперь занимает всю область
          без зарезервированной снизу полосы. */}
      <div className="browser-viewport-wrap" style={bottomMaximized ? { flex: '0 0 0px' } : undefined}>
        <BrowserViewport />
      </div>
      {bottomVisible ? (
        <BottomPanel
          tabs={tabsState.tabs}
          scans={scans}
          componentScans={componentScans}
          scanningTabId={scanningTabId}
          onScan={scanActiveTab}
          maximized={bottomMaximized}
          onMaximizedChange={setBottomMaximized}
          onMouseEnter={bottomReveal.onMouseEnter}
          onMouseLeave={bottomReveal.onMouseLeave}
        />
      ) : (
        <div
          className="edge-reveal-strip edge-reveal-strip-bottom"
          onMouseEnter={bottomReveal.onMouseEnter}
          onMouseLeave={bottomReveal.onMouseLeave}
        />
      )}
    </>
  )
}
