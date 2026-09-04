import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { PanelLeft, PanelRight, Pin } from 'lucide-react'
import { clamp, effectiveVariant, IconButton, isValidThemeDef, ThemeProvider, useResizer, useTheme } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { ThemeSyncMessage } from '@web-to-figma/bridge-protocol'
import type { AppSettings } from '../../shared/types'
import { BridgePopover } from './components/BridgePopover'
import { BrowserPane } from './components/BrowserPane'
import { InspectorPanel } from './components/InspectorPanel'
import { LeftSidebar } from './components/LeftSidebar'
import { ReferencesView } from './components/ReferencesView'
import { TopViewSwitch, type TopView } from './components/TopViewSwitch'
import { VersionBadge } from './components/VersionBadge'
import { useEdgeReveal } from './hooks/useEdgeReveal'

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
        onFullscreenModeChange={(fullscreenMode) => updateSettings({ fullscreenMode })}
        onReferenceNamePromptOnAddChange={(referenceNamePromptOnAdd) => updateSettings({ referenceNamePromptOnAdd })}
        onCaptureViewportChange={(captureViewport) => updateSettings({ captureViewport })}
        onCaptureFullBlockThumbnailChange={(captureFullBlockThumbnail) => updateSettings({ captureFullBlockThumbnail })}
        onSidePanelsHoverRevealChange={(sidePanelsHoverReveal) => updateSettings({ sidePanelsHoverReveal })}
      />
    </ThemeProvider>
  )
}

function Shell({
  settings,
  onThemeModeChange,
  onThemeIdChange,
  onCustomThemesChange,
  onThemeSyncEnabledChange,
  onFullscreenModeChange,
  onReferenceNamePromptOnAddChange,
  onCaptureViewportChange,
  onCaptureFullBlockThumbnailChange,
  onSidePanelsHoverRevealChange
}: {
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
  onThemeSyncEnabledChange: (enabled: boolean) => void
  onFullscreenModeChange: (mode: AppSettings['fullscreenMode']) => void
  onReferenceNamePromptOnAddChange: (enabled: boolean) => void
  onCaptureViewportChange: (value: AppSettings['captureViewport']) => void
  onCaptureFullBlockThumbnailChange: (enabled: boolean) => void
  onSidePanelsHoverRevealChange: (enabled: boolean) => void
}): JSX.Element {
  const { resolvedMode, theme } = useTheme()
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [activeView, setActiveView] = useState<TopView>('browser')
  const [externalTheme, setExternalTheme] = useState<ThemeSyncMessage['payload'] | null>(null)
  // Distraction-free режим (по запросу пользователя, Vivaldi-стиль) — НЕ
  // трогает leftOpen/rightOpen, это независимый визуальный оверлей поверх
  // них: выключение просто возвращает то состояние панелей, что было до
  // включения (см. effectiveLeftOpen/effectiveRightOpen в Workspace).
  // Раскрытие по наведению на край — не floating-панель поверх контента: та
  // не была бы видна поверх нативного WebContentsView браузера (см.
  // useEdgeReveal докстринг) — панели РАЗДВИГАЮТ browser-pane, макет вживую
  // подтверждён мокапом, см. обсуждение в чате.
  const [distractionFree, setDistractionFree] = useState(false)
  const topReveal = useEdgeReveal()

  // Плавающая верхняя панель браузера ('panel-top', float-режим, см.
  // BrowserTopBarOverlayContent.tsx) живёт в ДРУГОМ рендерере — её кнопка
  // "выключить полноэкранный режим" не может напрямую дёрнуть
  // setDistractionFree здесь, поэтому шлёт generic popoverAction (тот же
  // bounce-back, что уже использует AddToProjectButton для
  // CreateProjectModal), а не отдельный канал специально под этот случай.
  useEffect(
    () =>
      window.api.onPopoverAction((action) => {
        if (action.type === 'exit-distraction-free') setDistractionFree(false)
      }),
    []
  )

  // Вкладка "Референсы" (по запросу пользователя) — Workspace/BrowserPane
  // остаются смонтированными всегда (не теряем состояние вкладок браузера
  // при переключении), просто нулим bounds нативного WebContentsView + плавающий
  // тулбар пикера тем же способом, что уже используется для модалок
  // (usePopoverVisibility), см. main/index.ts browser:set-hidden/overlay:set-suppressed.
  useEffect(() => {
    window.api.browserSetHidden(activeView !== 'browser')
    window.api.overlaySetSuppressed(activeView !== 'browser')
    // Ушли со вкладки "Референсы" — завершаем возможную активную сессию сбора
    // референс-элементов (см. ReferenceBrowserPane.tsx), а не полагаемся на
    // unmount-cleanup ТАМ: под React StrictMode (dev) эффекты с cleanup
    // синтетически прогоняются mount→cleanup→mount уже на первом маунте —
    // cleanup, зовущий referenceSessionEnd(), обрывал сессию сразу после
    // старта (живой баг, поймал пользователь — "браузер моргает и
    // пропадает"). Здесь безопасно: эффект переисполняется по-настоящему
    // только при реальной смене activeView, а не при каждом маунте
    // ReferenceBrowserPane; вызов идемпотентен на main (см.
    // reference:session-end), пустой no-op, если сессии и так нет.
    if (activeView !== 'references') void window.api.referenceSessionEnd()
    // См. main/index.ts activeTopView докстринг — нужно ТОЛЬКО
    // leftPanelGate, чтобы знать, какой overlay-слой открывать при
    // наведении на левый край в float-режиме ('left' основного браузера
    // или 'references-left').
    void window.api.appSetActiveView(activeView)
  }, [activeView])

  useEffect(() => {
    if (!settings.themeSyncEnabled) return
    void window.api.syncPluginTheme({
      themeId: theme.id,
      mode: resolvedMode,
      vars: effectiveVariant(theme, resolvedMode)
    })
  }, [resolvedMode, theme, settings.themeSyncEnabled])

  // Обратное направление "полного синхрона" — тема, пришедшая в Bridge Tools
  // от Design Toolkit и пересланная сюда (см. main/index.ts theme-push).
  // Применяется поверх собственной темы через inline-style на .app (тот же
  // приём, что syncedThemeStyle в apps/figma-plugin App.tsx), не трогая
  // settings.json — выключение тумблера просто перестаёт слушать/применять.
  useEffect(() => window.api.onExternalThemeSync(setExternalTheme), [])
  const externalThemeStyle = useMemo<CSSProperties | undefined>(() => {
    if (!settings.themeSyncEnabled || !externalTheme) return undefined
    const properties: Record<string, string> = { colorScheme: externalTheme.mode }
    for (const [key, value] of Object.entries(externalTheme.vars)) properties[`--${key}`] = value
    return properties as CSSProperties
  }, [externalTheme, settings.themeSyncEnabled])

  const toolbarVisible = !distractionFree || topReveal.revealed

  return (
    <div className="app" style={externalThemeStyle}>
      {toolbarVisible ? (
        <div className="toolbar" onMouseEnter={topReveal.onMouseEnter} onMouseLeave={topReveal.onMouseLeave}>
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
          <TopViewSwitch value={activeView} onChange={setActiveView} />
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
      ) : (
        <div className="edge-reveal-strip edge-reveal-strip-top" onMouseEnter={topReveal.onMouseEnter} onMouseLeave={topReveal.onMouseLeave} />
      )}
      <div className={activeView === 'browser' ? 'view-slot' : 'view-slot hidden'}>
        <Workspace
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          distractionFree={distractionFree}
          onToggleDistractionFree={() => setDistractionFree((v) => !v)}
          settings={settings}
          onThemeModeChange={onThemeModeChange}
          onThemeIdChange={onThemeIdChange}
          onCustomThemesChange={onCustomThemesChange}
          onThemeSyncEnabledChange={onThemeSyncEnabledChange}
          onFullscreenModeChange={onFullscreenModeChange}
          onReferenceNamePromptOnAddChange={onReferenceNamePromptOnAddChange}
          onCaptureViewportChange={onCaptureViewportChange}
          onCaptureFullBlockThumbnailChange={onCaptureFullBlockThumbnailChange}
          onSidePanelsHoverRevealChange={onSidePanelsHoverRevealChange}
        />
      </div>
      {activeView === 'references' && (
        <div className="view-slot">
          <ReferencesView
            onOpenSite={(url) => {
              window.api.browserNavigate(url)
              setActiveView('browser')
            }}
            distractionFree={distractionFree}
            onToggleDistractionFree={() => setDistractionFree((v) => !v)}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            themeMode={settings.themeMode}
            onThemeModeChange={onThemeModeChange}
            themeId={settings.themeId}
            customThemes={settings.customThemes}
            onThemeIdChange={onThemeIdChange}
            onCustomThemesChange={onCustomThemesChange}
            themeSyncEnabled={settings.themeSyncEnabled}
            onThemeSyncEnabledChange={onThemeSyncEnabledChange}
            fullscreenMode={settings.fullscreenMode}
            onFullscreenModeChange={onFullscreenModeChange}
            referenceNamePromptOnAdd={settings.referenceNamePromptOnAdd}
            onReferenceNamePromptOnAddChange={onReferenceNamePromptOnAddChange}
            captureViewport={settings.captureViewport}
            onCaptureViewportChange={onCaptureViewportChange}
            captureFullBlockThumbnail={settings.captureFullBlockThumbnail}
            onCaptureFullBlockThumbnailChange={onCaptureFullBlockThumbnailChange}
            sidePanelsHoverReveal={settings.sidePanelsHoverReveal}
            onSidePanelsHoverRevealChange={onSidePanelsHoverRevealChange}
          />
        </div>
      )}
    </div>
  )
}

function Workspace({
  leftOpen,
  rightOpen,
  distractionFree,
  onToggleDistractionFree,
  settings,
  onThemeModeChange,
  onThemeIdChange,
  onCustomThemesChange,
  onThemeSyncEnabledChange,
  onFullscreenModeChange,
  onReferenceNamePromptOnAddChange,
  onCaptureViewportChange,
  onCaptureFullBlockThumbnailChange,
  onSidePanelsHoverRevealChange
}: {
  leftOpen: boolean
  rightOpen: boolean
  distractionFree: boolean
  onToggleDistractionFree: () => void
  settings: AppSettings
  onThemeModeChange: (mode: ThemeMode) => void
  onThemeIdChange: (themeId: string) => void
  onCustomThemesChange: (customThemes: ThemeDef[]) => void
  onThemeSyncEnabledChange: (enabled: boolean) => void
  onFullscreenModeChange: (mode: AppSettings['fullscreenMode']) => void
  onReferenceNamePromptOnAddChange: (enabled: boolean) => void
  onCaptureViewportChange: (value: AppSettings['captureViewport']) => void
  onCaptureFullBlockThumbnailChange: (enabled: boolean) => void
  onSidePanelsHoverRevealChange: (enabled: boolean) => void
}): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(260)
  const leftResizer = useResizer((dx) => setLeftWidth((w) => clamp(w + dx, 200, 480)))
  const [rightWidth, setRightWidth] = useState(360)
  const rightResizer = useResizer((dx) => setRightWidth((w) => clamp(w - dx, 260, 560)))
  // 'float' — второй режим distraction-free (по запросу пользователя, рядом
  // с 'push', см. AppSettings.fullscreenMode) — раскрытая по наведению
  // панель рисуется НАД browser-pane в отдельном overlay-слое (см.
  // PanelOverlayRoot.tsx), а не инлайн здесь (в 'push' инлайн-mount и есть
  // сам механизм раздвигания, см. effectiveLeftOpen/RightOpen ниже). В
  // distraction-free режиме leftOpen/rightOpen игнорируются, пока панель не
  // раскрыта — при выключении режима effectiveLeftOpen/RightOpen сам
  // вернётся к leftOpen/rightOpen, ничего специально восстанавливать не нужно.
  //
  // sidePanelsHoverReveal (по запросу пользователя, НЕЗАВИСИМО от
  // distractionFree — тот отдельно управляет "контуром полноэкранки
  // браузеров", см. BrowserPane.tsx isTopFloat, специально не смешивается
  // сюда) — второй, независимый триггер того же hover-reveal механизма:
  // закрытая кнопкой панель (leftOpen/rightOpen === false) раскрывается по
  // наведению в стиле fullscreenMode, даже БЕЗ входа в полноэкранный режим.
  // Открытая кнопкой панель показывается как обычно всегда.
  const sidePanelsHoverReveal = settings.sidePanelsHoverReveal
  const revealPossible = distractionFree || sidePanelsHoverReveal
  const isFloat = revealPossible && settings.fullscreenMode === 'float'
  const leftReveal = useEdgeReveal()
  const rightReveal = useEdgeReveal()
  // Закрепление панели (по запросу пользователя, "в любом полноэкранном
  // режиме") — держит панель открытой независимо от наведения, пока не
  // открепят явно. В float-режиме закреплённая панель переключается на
  // inline-показ здесь же (то же самое, что push) — плавающий слой ей больше
  // не нужен, см. main/index.ts overlay:popover-action 'pin-panel' (форсит
  // закрытие слоя). Кнопка закрепления показывается и в PanelOverlayRoot.tsx
  // (пока панель ЕЩЁ плавает) — та живёт в другом рендерере, поэтому шлёт то
  // же действие через тот же generic popoverAction bounce-back, что и
  // "выключить полноэкранный режим" у BrowserTopBarOverlayContent.tsx.
  const [leftPinned, setLeftPinned] = useState(false)
  const [rightPinned, setRightPinned] = useState(false)
  const [topPinned, setTopPinned] = useState(false)
  useEffect(
    () =>
      window.api.onPopoverAction((action) => {
        if (action.type !== 'pin-panel') return
        const { side, pinned } = action.payload as { side: 'left' | 'right' | 'top'; pinned: boolean }
        if (side === 'left') setLeftPinned(pinned)
        else if (side === 'right') setRightPinned(pinned)
        else setTopPinned(pinned)
      }),
    []
  )
  const togglePin = (side: 'left' | 'right' | 'top', pinned: boolean): void => {
    void window.api.popoverAction({ type: 'pin-panel', payload: { side, pinned } })
  }
  const effectiveLeftOpen = distractionFree
    ? leftPinned || (!isFloat && leftReveal.revealed)
    : leftOpen || (sidePanelsHoverReveal && (leftPinned || (!isFloat && leftReveal.revealed)))
  const effectiveRightOpen = distractionFree
    ? rightPinned || (!isFloat && rightReveal.revealed)
    : rightOpen || (sidePanelsHoverReveal && (rightPinned || (!isFloat && rightReveal.revealed)))
  const leftNormallyOpen = !distractionFree && leftOpen
  const rightNormallyOpen = !distractionFree && rightOpen
  const leftRevealAvailable = distractionFree ? leftOpen : sidePanelsHoverReveal && !leftOpen
  const rightRevealAvailable = distractionFree ? rightOpen : sidePanelsHoverReveal && !rightOpen
  const pinActionVisible = distractionFree || sidePanelsHoverReveal
  // В float-режиме полоска — единственный источник наведения В ЭТОМ окне
  // (второй — сама плавающая панель в своём overlay-слое, см.
  // PanelOverlayRoot.tsx) — оба независимо шлют overlay:panel-hover, main
  // держит панель открытой, пока жив хотя бы один (см. createHoverGate).
  const leftStripHandlers = isFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'left', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'left', entering: false })
      }
    : { onMouseEnter: leftReveal.onMouseEnter, onMouseLeave: leftReveal.onMouseLeave }
  const rightStripHandlers = isFloat
    ? {
        onMouseEnter: () => void window.api.overlayPanelHover({ side: 'right', entering: true }),
        onMouseLeave: () => void window.api.overlayPanelHover({ side: 'right', entering: false })
      }
    : { onMouseEnter: rightReveal.onMouseEnter, onMouseLeave: rightReveal.onMouseLeave }

  return (
    <div className="workspace">
      {effectiveLeftOpen ? (
        <>
          <div className="col" style={{ width: leftWidth }} onMouseEnter={leftReveal.onMouseEnter} onMouseLeave={leftReveal.onMouseLeave}>
            <LeftSidebar
              themeMode={settings.themeMode}
              onThemeModeChange={onThemeModeChange}
              themeId={settings.themeId}
              customThemes={settings.customThemes}
              onThemeIdChange={onThemeIdChange}
              onCustomThemesChange={onCustomThemesChange}
              themeSyncEnabled={settings.themeSyncEnabled}
              onThemeSyncEnabledChange={onThemeSyncEnabledChange}
              pinAction={
                pinActionVisible && (
                  <IconButton active={leftPinned} onClick={() => togglePin('left', !leftPinned)} title={leftPinned ? 'Открепить панель' : 'Закрепить панель'}>
                    <Pin size={13} fill={leftPinned ? 'currentColor' : 'none'} />
                  </IconButton>
                )
              }
              fullscreenMode={settings.fullscreenMode}
              onFullscreenModeChange={onFullscreenModeChange}
              referenceNamePromptOnAdd={settings.referenceNamePromptOnAdd}
              onReferenceNamePromptOnAddChange={onReferenceNamePromptOnAddChange}
              captureViewport={settings.captureViewport}
              onCaptureViewportChange={onCaptureViewportChange}
              captureFullBlockThumbnail={settings.captureFullBlockThumbnail}
              onCaptureFullBlockThumbnailChange={onCaptureFullBlockThumbnailChange}
              sidePanelsHoverReveal={sidePanelsHoverReveal}
              onSidePanelsHoverRevealChange={onSidePanelsHoverRevealChange}
            />
          </div>
          <div className={`resizer${leftNormallyOpen ? '' : ' static'}`} {...(leftNormallyOpen ? leftResizer : {})} />
        </>
      ) : (
        leftRevealAvailable && <div className="edge-reveal-strip edge-reveal-strip-left" {...leftStripHandlers} />
      )}
      <div className="col center-col">
        <BrowserPane
          distractionFree={distractionFree}
          onToggleDistractionFree={onToggleDistractionFree}
          fullscreenMode={settings.fullscreenMode}
          topPinned={topPinned}
          onToggleTopPinned={() => togglePin('top', !topPinned)}
        />
      </div>
      {effectiveRightOpen ? (
        <>
          <div className={`resizer${rightNormallyOpen ? '' : ' static'}`} {...(rightNormallyOpen ? rightResizer : {})} />
          <div
            className="col"
            style={{ width: rightWidth }}
            onMouseEnter={rightReveal.onMouseEnter}
            onMouseLeave={rightReveal.onMouseLeave}
          >
            <InspectorPanel
              pinAction={
                pinActionVisible && (
                  <IconButton active={rightPinned} onClick={() => togglePin('right', !rightPinned)} title={rightPinned ? 'Открепить панель' : 'Закрепить панель'}>
                    <Pin size={13} fill={rightPinned ? 'currentColor' : 'none'} />
                  </IconButton>
                )
              }
            />
          </div>
        </>
      ) : (
        rightRevealAvailable && <div className="edge-reveal-strip edge-reveal-strip-right" {...rightStripHandlers} />
      )}
    </div>
  )
}
