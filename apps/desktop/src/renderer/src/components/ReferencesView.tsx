import { useEffect, useState } from 'react'
import { ArrowLeft, Globe, Pin } from 'lucide-react'
import { clamp, IconButton, useResizer } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { AppSettings, Project, ReferenceSessionState, StandaloneReferenceSite } from '../../../shared/types'
import { useEdgeReveal } from '../hooks/useEdgeReveal'
import { AttachToProjectRow } from './AttachToProjectRow'
import { ProjectCard } from './ProjectCard'
import { ReferenceBrowserPane } from './ReferenceBrowserPane'
import { ReferenceItemsPanel } from './ReferenceItemsPanel'
import { ReferencesSearchBar } from './ReferencesSearchBar'
import { ReferencesSidebar } from './ReferencesSidebar'
import { SiteCard } from './SiteCard'

interface Props {
  onOpenSite: (url: string) => void
  distractionFree: boolean
  onToggleDistractionFree: () => void
  /** Кнопки "Левая/правая панель" в тулбаре приложения (App.tsx Shell) — тот
   *  же state, что уже управляет панелями вкладки "Браузер". */
  leftOpen: boolean
  rightOpen: boolean
  /** Настройки — вкладка "Референсы" получила свой сайдбар (ReferencesSidebar,
   *  замена хлебных крошек) и вместе с ним потеряла доступ к кнопке
   *  "Настройки" (та жила только в LeftSidebar.tsx основного браузера) — живой
   *  баг, поймал пользователь. Тот же набор пропов, что уже прокидывается в
   *  Workspace/LeftSidebar из Shell, просто ещё сюда же. */
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
  themeSyncEnabled: boolean
  onThemeSyncEnabledChange: (enabled: boolean) => void
  fullscreenMode: AppSettings['fullscreenMode']
  onFullscreenModeChange: (mode: AppSettings['fullscreenMode']) => void
  referenceNamePromptOnAdd: boolean
  onReferenceNamePromptOnAddChange: (enabled: boolean) => void
  captureViewport: AppSettings['captureViewport']
  onCaptureViewportChange: (value: AppSettings['captureViewport']) => void
  captureFullBlockThumbnail: boolean
  onCaptureFullBlockThumbnailChange: (enabled: boolean) => void
  sidePanelsHoverReveal: boolean
  onSidePanelsHoverRevealChange: (enabled: boolean) => void
}

interface SelectedSite {
  projectId: string | null
  url: string
}

/**
 * Вкладка верхнего уровня "Референсы" — трёхколоночный воркспейс (по
 * запросу пользователя, замена прежнего drill-down проекты→сайты→деталь),
 * структурно зеркальный основному Workspace вкладки "Браузер" (App.tsx):
 * левая `ReferencesSidebar` (навигация — проекты/сайты вместо хлебных
 * крошек), центр (стартовый экран с поиском ИЛИ embedded-браузер сбора),
 * правая `ReferenceItemsPanel` (галерея референс-элементов текущего сайта,
 * видна независимо от того, идёт ли сейчас сбор). Резайз колонок — тот же
 * `useResizer`, что уже двигает left/right панели основного Workspace.
 * Фуллскрин — тот же `distractionFree`, что уже прячет верхний тулбар
 * приложения (см. App.tsx Shell); левая И правая колонки в этом режиме —
 * hover-reveal полоска + закрепление (тот же `useEdgeReveal`/pin-паттерн, что
 * App.tsx Workspace уже даёт LeftSidebar/InspectorPanel, по запросу
 * пользователя "панели должны работать так же, как на основном окне").
 * ЛЕВАЯ, ПРАВАЯ и ВЕРХНЯЯ колонки — все теперь настоящий float (по прямому
 * требованию пользователя, "критично, делай float"): каждая рисуется в
 * ОТДЕЛЬНОМ overlay-слое (см. main/overlay.ts, PanelOverlayRoot.tsx),
 * ложится НАД нативным `WebContentsView` браузера (тот всегда поверх HTML,
 * см. browser.ts класс-докстринг), а не push'ит контент инлайн. Левая —
 * 'panel-references-left' (просто навигация, ретранслирует ДВА исходящих
 * клика через references:overlay-select-site/-open-site, см. selectSite
 * ниже). Правая — 'panel-references-right': ReferenceItemsPanel и
 * AttachToProjectRow там ОБА самодостаточны (читают/пишут состояние сами
 * через window.api, не через пропы родителя), единственное, что нужно было
 * синхронизировать между процессами — ТЕКУЩИЙ `session` (какой сайт
 * собираем) — тот уже и так живёт в main (referenceSession, см.
 * main/index.ts broadcastReferenceSession), просто добавлена рассылка ЕЩЁ и
 * в этот overlay-слой плюс geттер для начального значения при монтировании
 * (см. window.api.referenceGetSessionState). Верхняя (см.
 * ReferenceBrowserPane.tsx) — тот же 'panel-top' overlay-слой, что и у
 * основного браузера, сам решает (см. window.api.onReferenceBrowserVisible),
 * каким из двух браузеров управлять.
 *
 * Стартовый экран (когда конкретный сайт ещё не выбран) — ДВА под-уровня:
 * сетка всех проектов, и (клик по карточке) сетка референс-сайтов ВНУТРИ
 * выбранного проекта (`openProjectId`) — то же самое, что раньше делал
 * старый drill-down, просто теперь это только "быстрый обзор" под строкой
 * поиска, а не единственный способ навигации (тот теперь в сайдбаре).
 */
export function ReferencesView({
  onOpenSite,
  distractionFree,
  onToggleDistractionFree,
  leftOpen,
  rightOpen,
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange,
  themeSyncEnabled,
  onThemeSyncEnabledChange,
  fullscreenMode,
  onFullscreenModeChange,
  referenceNamePromptOnAdd,
  onReferenceNamePromptOnAddChange,
  captureViewport,
  onCaptureViewportChange,
  captureFullBlockThumbnail,
  onCaptureFullBlockThumbnailChange,
  sidePanelsHoverReveal,
  onSidePanelsHoverRevealChange
}: Props): JSX.Element {
  const [selectedSite, setSelectedSite] = useState<SelectedSite | null>(null)
  // "Поиск сайта" (по запросу пользователя — гугл-запрос из строки поиска
  // не должен сразу становиться standalone-референсом и запускать пикер) —
  // промежуточный режим между стартовым экраном и полноценной сессией
  // сбора: обычный встроенный браузер (см. reference:browse-start), без
  // панели-пикера (тот просто не запускается) и без записи в
  // standaloneReferenceSitesStore, пока пользователь явно не нажмёт "Начать
  // сбор" на найденной странице.
  const [browsing, setBrowsing] = useState(false)
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [leftWidth, setLeftWidth] = useState(260)
  const leftResizer = useResizer((dx) => setLeftWidth((w) => clamp(w + dx, 200, 480)))
  const [rightWidth, setRightWidth] = useState(340)
  const rightResizer = useResizer((dx) => setRightWidth((w) => clamp(w - dx, 260, 520)))
  // Левая панель теперь float-способна (см. ниже) — pin бьётся через тот же
  // main/overlay.ts pin-panel bounce-back, что и у основного браузера, НО
  // отдельным side'ом 'references-left' (не 'left' — тот заводит СВОЙ
  // leftPinned в App.tsx Workspace, общий канал перепутал бы состояние
  // между вкладками при каждом клике "Закрепить"). Правая панель
  // (push-only, см. ниже) осталась полностью локальной.
  const [leftPinned, setLeftPinned] = useState(false)
  // Правая панель (галерея референсов) теперь ТОЖЕ настоящий float (по
  // прямому требованию пользователя — "критично, делай float", см.
  // main/index.ts rightPanelGate/activeTopView) — тот же bounce-back
  // pin-panel канал, что и у левой, просто своим side'ом ('references-right'),
  // поэтому оба слушаются одной подпиской.
  useEffect(
    () =>
      window.api.onPopoverAction((action) => {
        if (action.type !== 'pin-panel') return
        const { side, pinned } = action.payload as { side: string; pinned: boolean }
        if (side === 'references-left') setLeftPinned(pinned)
        else if (side === 'references-right') setRightPinned(pinned)
      }),
    []
  )
  const leftReveal = useEdgeReveal()
  const [rightPinned, setRightPinned] = useState(false)
  const rightReveal = useEdgeReveal()
  // distractionFree (см. класс-докстринг) — как раньше, ВСЕГДА схлопывает
  // панель независимо от leftOpen/rightOpen, пока не закреплена/наведена.
  // sidePanelsHoverReveal (по запросу пользователя, НЕЗАВИСИМО от
  // distractionFree) — противоположная механика: leftOpen/rightOpen ЕСТЬ
  // база (=== true всегда показывает как обычно), а раскрытие по наведению
  // включается только если панель ЗАКРЫТА кнопкой И настройка включена —
  // так можно получить hover-reveal панелей БЕЗ входа в полноэкранный режим
  // вообще. Оба механизма объединены через ||, не конфликтуют: distraction-
  // free тут приоритетнее (полностью не зависит от leftOpen/rightOpen).
  //
  // Обе боковые панели теперь ПРАВДА float (по прямому требованию
  // пользователя, "критично, делай float") — раскрытая панель рисуется в
  // ОТДЕЛЬНОМ overlay-слое ('panel-references-left'/'panel-references-right',
  // см. main/index.ts activeTopView/PanelOverlayRoot.tsx), а не инлайн
  // здесь, тем же приёмом, что App.tsx Workspace уже даёт
  // LeftSidebar/InspectorPanel.
  const isLeftFloat = (distractionFree || sidePanelsHoverReveal) && fullscreenMode === 'float'
  const isRightFloat = (distractionFree || sidePanelsHoverReveal) && fullscreenMode === 'float'
  const effectiveLeftOpen = distractionFree
    ? leftPinned || (!isLeftFloat && leftReveal.revealed)
    : leftOpen || (sidePanelsHoverReveal && (leftPinned || (!isLeftFloat && leftReveal.revealed)))
  const effectiveRightOpen = distractionFree
    ? rightPinned || (!isRightFloat && rightReveal.revealed)
    : rightOpen || (sidePanelsHoverReveal && (rightPinned || (!isRightFloat && rightReveal.revealed)))
  const leftStripHandlers = isLeftFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'references-left', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'references-left', entering: false })
      }
    : { onMouseEnter: leftReveal.onMouseEnter, onMouseLeave: leftReveal.onMouseLeave }
  const rightStripHandlers = isRightFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'references-right', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'references-right', entering: false })
      }
    : { onMouseEnter: rightReveal.onMouseEnter, onMouseLeave: rightReveal.onMouseLeave }
  // Раскрыт "по-настоящему" (не наведением/пином) — resizer интерактивен
  // ТОЛЬКО тогда, тем же смыслом, что и раньше (просто явно вынесено,
  // раз теперь два независимых источника hover-reveal, а не один
  // distractionFree). Полоска-hint (edge-reveal-strip) видна в
  // противоположном случае — панель СЕЙЧАС не раскрыта, но раскрытие по
  // наведению доступно хотя бы одним из двух механизмов.
  const leftNormallyOpen = !distractionFree && leftOpen
  const rightNormallyOpen = !distractionFree && rightOpen
  const leftRevealAvailable = distractionFree ? leftOpen : sidePanelsHoverReveal && !leftOpen
  const rightRevealAvailable = distractionFree ? rightOpen : sidePanelsHoverReveal && !rightOpen
  const pinActionVisible = distractionFree || sidePanelsHoverReveal

  const [projects, setProjects] = useState<Project[]>([])
  const [standalone, setStandalone] = useState<StandaloneReferenceSite[]>([])
  const [session, setSession] = useState<ReferenceSessionState | null>(null)

  useEffect(() => {
    window.api.projectsGet().then((s) => setProjects(s.projects))
    return window.api.onProjectsUpdated((s) => setProjects(s.projects))
  }, [])
  useEffect(() => {
    window.api.standaloneReferencesGet().then(setStandalone)
    return window.api.onStandaloneReferencesUpdated(setStandalone)
  }, [])
  useEffect(() => window.api.onReferenceSessionState(setSession), [])

  const selectedProject = selectedSite?.projectId ? projects.find((p) => p.id === selectedSite.projectId) ?? null : null
  const selectedProjectSite = selectedProject?.sites.find((s) => s.url === selectedSite?.url) ?? null
  const selectedStandaloneSite = selectedSite && !selectedSite.projectId ? standalone.find((s) => s.url === selectedSite.url) ?? null : null
  const siteTitle = selectedProjectSite?.title || selectedStandaloneSite?.title || selectedSite?.url || ''
  const siteFavicon = selectedProjectSite?.faviconUrl ?? selectedStandaloneSite?.faviconUrl ?? null

  const collecting = Boolean(
    session && selectedSite && session.projectId === selectedSite.projectId && session.siteUrl === selectedSite.url
  )

  const openProject = openProjectId ? projects.find((p) => p.id === openProjectId) ?? null : null

  const submitSearch = (value: string): void => {
    // Раньше сразу открывал сессию сбора — живой баг: гугл-запрос ("react
    // hooks туториал" и т.п.) немедленно сохранялся как standalone-
    // референс. Теперь просто "поиск" (см. browsing докстринг выше) —
    // сессия стартует явным кликом на найденной странице.
    setBrowsing(true)
    void window.api.referenceBrowseStart(value)
  }

  const cancelBrowsing = (): void => {
    setBrowsing(false)
    void window.api.referenceSessionEnd()
    // "Контур полноэкранки браузеров" (distractionFree) без браузера больше
    // не за чем — раньше оставался включённым после выхода, интерфейс
    // застревал со свёрнутыми панелями без видимой причины (живой баг,
    // поймал пользователь: "выйдет но не выключит полноэкранку").
    if (distractionFree) onToggleDistractionFree()
  }

  const commitBrowsing = async (): Promise<void> => {
    const tabs = await window.api.referenceBrowserGetTabs()
    const active = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    const url = active?.url
    // Стартовая страница (data: URL) — кнопка "Начать сбор" технически
    // кликабельна и до того, как поиск успел куда-то перейти (гонка клика с
    // навигацией) — не сырой data: URL не должен становиться "сайтом" нигде
    // (см. main/index.ts isSearchQueryUrl докстринг про тот же принцип для
    // гугл-поиска), тут то же самое для самой стартовой страницы.
    if (!url || url.startsWith('data:text/html')) return
    setBrowsing(false)
    // Привязка к проекту ("Прикрепить к проекту") делается потом, отдельным
    // действием в правой колонке (см. AttachToProjectRow ниже) — по
    // решению пользователя, тот же путь, что раньше был у submitSearch.
    setSelectedSite({ projectId: null, url })
    void window.api.referenceSessionStart(null, url)
  }

  const selectSite = (projectId: string | null, url: string): void => {
    // Тот же живой баг, что и у кнопки "Назад" (см. её докстринг чуть ниже)
    // — переключение на ДРУГОЙ сайт из сайдбара, пока где-то ещё идёт сбор,
    // размонтирует ReferenceBrowserPane, но не сам нативный слой в main.
    if (collecting) void window.api.referenceSessionEnd()
    setOpenProjectId(null)
    setSelectedSite({ projectId, url })
  }

  // Клик по сайту/проекту в ПЛАВАЮЩЕЙ левой панели (float-режим, см.
  // PanelOverlayRoot.tsx side:'references-left') — та живёт в другом
  // рендерере и не может напрямую вызвать selectSite/onOpenSite здесь,
  // просто ретранслирует клик через main (см. main/index.ts
  // references:overlay-select-site/-open-site).
  useEffect(() => window.api.onReferencesOverlaySelectSite(selectSite), [selectSite])
  useEffect(() => window.api.onReferencesOverlayOpenSite(onOpenSite), [onOpenSite])

  return (
    <div className="workspace references-workspace">
      {/* Без панелей в режиме "поиска" (по запросу пользователя) — левый
          сайдбар тут просто не нужен, весь фокус на найденной странице. */}
      {effectiveLeftOpen && !browsing ? (
        <>
          <div
            className="col"
            style={{ width: leftWidth }}
            onMouseEnter={leftReveal.onMouseEnter}
            onMouseLeave={leftReveal.onMouseLeave}
          >
            <ReferencesSidebar
              onOpenSite={onOpenSite}
              onSelectReference={selectSite}
              themeMode={themeMode}
              onThemeModeChange={onThemeModeChange}
              themeId={themeId}
              customThemes={customThemes}
              onThemeIdChange={onThemeIdChange}
              onCustomThemesChange={onCustomThemesChange}
              themeSyncEnabled={themeSyncEnabled}
              onThemeSyncEnabledChange={onThemeSyncEnabledChange}
              fullscreenMode={fullscreenMode}
              onFullscreenModeChange={onFullscreenModeChange}
              referenceNamePromptOnAdd={referenceNamePromptOnAdd}
              onReferenceNamePromptOnAddChange={onReferenceNamePromptOnAddChange}
              captureViewport={captureViewport}
              onCaptureViewportChange={onCaptureViewportChange}
              captureFullBlockThumbnail={captureFullBlockThumbnail}
              onCaptureFullBlockThumbnailChange={onCaptureFullBlockThumbnailChange}
              sidePanelsHoverReveal={sidePanelsHoverReveal}
              onSidePanelsHoverRevealChange={onSidePanelsHoverRevealChange}
              pinAction={
                pinActionVisible && (
                  <IconButton
                    active={leftPinned}
                    onClick={() => void window.api.popoverAction({ type: 'pin-panel', payload: { side: 'references-left', pinned: !leftPinned } })}
                    title={leftPinned ? 'Открепить панель' : 'Закрепить панель'}
                  >
                    <Pin size={13} fill={leftPinned ? 'currentColor' : 'none'} />
                  </IconButton>
                )
              }
            />
          </div>
          <div className={`resizer${leftNormallyOpen ? '' : ' static'}`} {...(leftNormallyOpen ? leftResizer : {})} />
        </>
      ) : (
        !browsing && leftRevealAvailable && <div className="edge-reveal-strip edge-reveal-strip-left" {...leftStripHandlers} />
      )}

      <div className="col center-col">
        {browsing ? (
          <>
            <div className="reference-compact-head">
              <button className="icon-btn xs" title="Отменить поиск" onClick={cancelBrowsing}>
                <ArrowLeft size={14} />
              </button>
              <span className="reference-compact-title">Поиск сайта — выберите страницу для сбора референсов</span>
              <button className="reference-compact-collect-btn" onClick={commitBrowsing}>
                Начать сбор референсов
              </button>
            </div>
            <ReferenceBrowserPane distractionFree={distractionFree} onToggleDistractionFree={onToggleDistractionFree} fullscreenMode={fullscreenMode} />
          </>
        ) : !selectedSite ? (
          <div className="references-start">
            <ReferencesSearchBar onSubmit={submitSearch} />
            {openProject ? (
              <>
                <button className="references-back" onClick={() => setOpenProjectId(null)}>
                  <ArrowLeft size={14} /> Назад к проектам
                </button>
                <h2 className="references-project-title">{openProject.name}</h2>
                {(() => {
                  const references = openProject.sites.filter((s) => s.kind === 'reference')
                  return references.length === 0 ? (
                    <div className="placeholder-hint references-empty">В этом проекте пока нет референсов.</div>
                  ) : (
                    <div className="site-card-grid">
                      {references.map((s) => (
                        <SiteCard
                          key={s.url}
                          site={s}
                          onClick={() => selectSite(openProject.id, s.url)}
                          onRemove={() => window.api.projectsRemoveSite(openProject.id, s.url)}
                        />
                      ))}
                    </div>
                  )
                })()}
              </>
            ) : projects.length === 0 ? (
              <div className="placeholder-hint references-empty">
                Пока нет проектов — добавьте сайт в проект кнопкой в тулбаре браузера, или начните с поиска выше.
              </div>
            ) : (
              <div className="project-card-grid">
                {projects.map((p) => (
                  <ProjectCard key={p.id} project={p} onClick={() => setOpenProjectId(p.id)} />
                ))}
              </div>
            )}
            {/* "Без проекта" карточками на стартовом экране (по запросу
                пользователя) — раньше эти сайты были видны только строками в
                левом сайдборе, тут та же SiteCard, что и у обычных
                референсов внутри проекта. Только на верхнем уровне (не
                внутри openProject — там своя, другая "полка"). */}
            {!openProject && standalone.length > 0 && (
              <>
                <div className="references-section-divider">Без проекта</div>
                <div className="site-card-grid">
                  {standalone.map((s) => (
                    <SiteCard
                      key={s.url}
                      site={s}
                      onClick={() => selectSite(null, s.url)}
                      onRemove={() => window.api.standaloneReferencesRemove(s.url)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="reference-compact-head">
              <button
                className="icon-btn xs"
                title="Назад"
                onClick={() => {
                  // Если сбор ещё активен — сначала закрыть встроенный
                  // браузер (тот же вызов, что кнопка "Закрыть браузер"
                  // ниже), а не просто перестать его РЕНДЕРИТЬ: React
                  // размонтирует ReferenceBrowserPane, но нативный
                  // WebContentsView в main-процессе не привязан к этому
                  // React-дереву — без явного referenceSessionEnd() он так
                  // и остаётся висеть на своих последних bounds ПОД новым
                  // экраном (живой баг, поймал пользователь скриншотом —
                  // стартовый экран "Референсов" прорисовался поверх ещё
                  // живого встроенного браузера с пикер-тулбаром).
                  if (collecting) {
                    void window.api.referenceSessionEnd()
                    // Без браузера "контур полноэкранки" (distractionFree)
                    // больше не за чем — живой баг, поймал пользователь:
                    // "выйдет но не выключит полноэкранку".
                    if (distractionFree) onToggleDistractionFree()
                  }
                  // Назад на уровень ВЫШЕ (список референсов текущего
                  // проекта), а не сразу в самый верх на сетку ВСЕХ
                  // проектов — той стрелка ошибочно вела до предыдущего
                  // фикса. Для standalone-сайта (без проекта) уровня
                  // "список референсов проекта" не существует — там и
                  // раньше корректно уходило в самый верх.
                  if (selectedSite?.projectId) setOpenProjectId(selectedSite.projectId)
                  setSelectedSite(null)
                }}
              >
                <ArrowLeft size={14} />
              </button>
              {siteFavicon ? (
                <img className="reference-compact-favicon" src={siteFavicon} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
              ) : (
                <Globe size={14} className="reference-compact-favicon-fallback" />
              )}
              <span className="reference-compact-title">{siteTitle}</span>
              <button
                className="reference-compact-collect-btn"
                onClick={() => {
                  if (collecting) {
                    void window.api.referenceSessionEnd()
                    if (distractionFree) onToggleDistractionFree()
                  } else {
                    void window.api.referenceSessionStart(selectedSite.projectId, selectedSite.url)
                  }
                }}
              >
                {collecting ? 'Закрыть браузер' : 'Открыть браузер'}
              </button>
            </div>
            {collecting ? (
              <ReferenceBrowserPane
                distractionFree={distractionFree}
                onToggleDistractionFree={onToggleDistractionFree}
                fullscreenMode={fullscreenMode}
              />
            ) : (
              // Пока браузер закрыт, центр — не пустая подсказка (живая
              // жалоба пользователя на впустую пропадающее место), а сама
              // галерея уже собранных элементов, тот же ReferenceItemsPanel,
              // что и в правой колонке во время сбора (см. ниже) — включая
              // "Отправить все" по тому же запросу.
              <ReferenceItemsPanel
                session={{ projectId: selectedSite.projectId, siteUrl: selectedSite.url, siteTitle }}
                emptyHint='Нажмите "Открыть браузер" и выбирайте элементы пикером — они появятся здесь карточками.'
                sendAllPlacement="bottom"
              />
            )}
            {!collecting && !selectedSite.projectId && <AttachToProjectRow url={selectedSite.url} />}
          </>
        )}
      </div>

      {selectedSite && collecting && effectiveRightOpen ? (
        <>
          <div className={`resizer${rightNormallyOpen ? '' : ' static'}`} {...(rightNormallyOpen ? rightResizer : {})} />
          <div
            className="col references-right-col"
            style={{ width: rightWidth }}
            onMouseEnter={rightReveal.onMouseEnter}
            onMouseLeave={rightReveal.onMouseLeave}
          >
            <ReferenceItemsPanel
              session={{
                projectId: selectedSite.projectId,
                siteUrl: selectedSite.url,
                siteTitle
              }}
              pinAction={
                pinActionVisible && (
                  <IconButton
                    active={rightPinned}
                    onClick={() =>
                      void window.api.popoverAction({ type: 'pin-panel', payload: { side: 'references-right', pinned: !rightPinned } })
                    }
                    title={rightPinned ? 'Открепить панель' : 'Закрепить панель'}
                  >
                    <Pin size={13} fill={rightPinned ? 'currentColor' : 'none'} />
                  </IconButton>
                )
              }
            />
            {!selectedSite.projectId && <AttachToProjectRow url={selectedSite.url} />}
          </div>
        </>
      ) : (
        selectedSite && collecting && rightRevealAvailable && (
          <div className="edge-reveal-strip edge-reveal-strip-right" {...rightStripHandlers} />
        )
      )}
    </div>
  )
}

