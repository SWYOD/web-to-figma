import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { IconButton, isValidThemeDef, ThemeProvider } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { BrowserTopBarOverlayContent } from './components/BrowserTopBarOverlayContent'
import { InspectorPanel } from './components/InspectorPanel'
import { LeftSidebar } from './components/LeftSidebar'
import { ReferencesRightPanelOverlayContent } from './components/ReferencesRightPanelOverlayContent'
import { ReferencesSidebar } from './components/ReferencesSidebar'

interface Props {
  side: 'left' | 'right' | 'top' | 'references-left' | 'references-right'
}

/**
 * Смонтирован вместо `App`/`OverlayRoot`/`PopoverOverlayRoot` в overlay-слое
 * `panel-left`/`panel-right`/`panel-references-left`/`panel-references-right`
 * (см. main/overlay.ts, App.tsx Workspace) — float-режим distraction-free (по
 * запросу пользователя, второй режим рядом с push, см. AppSettings.fullscreenMode):
 * та же панель, что рисуется в push-режиме прямо в главном окне
 * (`LeftSidebar`/`InspectorPanel`/`ReferencesSidebar`/`ReferenceItemsPanel`),
 * но здесь — в отдельном слое НАД browser-pane, не раздвигая его. `side`
 * закодирован в URL (`?overlay=panel-left`/`-right`/`-references-left`/
 * `-references-right`, см. main.tsx) — слой монтируется один раз и дальше
 * только меняет bounds (repositionPanelOverlay в main/index.ts), контент
 * живёт постоянно, как и у плавающего тулбара пикера.
 *
 * 'references-left'/'references-right' — ОТДЕЛЬНЫЕ от 'left'/'right' слои
 * (не те же самые с разным контентом) — см. main/index.ts activeTopView
 * докстринг. Левая: `onOpenSite`/`onSelectReference` здесь не могут
 * напрямую менять React state ReferencesView.tsx (тот в главном окне, другой
 * процесс) — просто ретранслируют клик через `references:overlay-*` IPC,
 * ReferencesView.tsx сам подписан и применяет у себя. Правая
 * (ReferencesRightPanelOverlayContent) — читает `session` сама через
 * window.api, ReferenceItemsPanel/AttachToProjectRow оба самодостаточны, ей
 * не нужно ничего ретранслировать обратно.
 *
 * Настройки темы читает и пишет сама (тот же паттерн, что PopoverOverlayRoot)
 * — LeftSidebar в главном окне получает их пропсами от App.tsx, здесь такого
 * родителя нет, это отдельный renderer-процесс.
 *
 * mouseenter/mouseleave — свой независимый источник наведения для
 * createHoverGate в main/index.ts (второй, кроме тонкой полоски в главном
 * окне) — панель должна оставаться открытой, пока курсор реально на ней,
 * даже после того как полоска под ней (в другом окне) перестала быть под
 * курсором.
 */
export function PanelOverlayRoot({ side }: Props): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings({ ...s, customThemes: s.customThemes.filter(isValidThemeDef) }))
  }, [])

  if (!settings) return null

  const updateSettings = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    window.api.saveSettings(next)
  }

  // Одностороннее закрепление отсюда (см. LeftSidebar.tsx/InspectorPanel.tsx
  // Props.pinAction) — пока панель плавает, кнопка только ЗАКРЕПЛЯЕТ (в
  // отличие от App.tsx Workspace, где та же кнопка переключается туда-обратно):
  // после закрепления main форсит закрытие этого слоя (см. main/index.ts
  // overlay:popover-action) и контент этого рендерера больше не виден —
  // открепление показывается уже там, в инлайн-версии.
  const pinAction = (side === 'left' || side === 'right' || side === 'references-left' || side === 'references-right') && (
    <IconButton
      title="Закрепить панель"
      onClick={() => void window.api.popoverAction({ type: 'pin-panel', payload: { side, pinned: true } })}
    >
      <Pin size={13} />
    </IconButton>
  )

  return (
    <ThemeProvider
      mode={settings.themeMode}
      onModeChange={(themeMode) => updateSettings({ themeMode })}
      themeId={settings.themeId}
      customThemes={settings.customThemes}
      onThemeIdChange={(themeId) => updateSettings({ themeId })}
    >
      <div
        className={side === 'top' ? 'browser-top-overlay-wrap' : 'col panel-overlay-col'}
        onMouseEnter={() => void window.api.overlayPanelHover({ side, entering: true })}
        onMouseLeave={() => void window.api.overlayPanelHover({ side, entering: false })}
      >
        {side === 'left' && (
          <LeftSidebar
            themeMode={settings.themeMode}
            onThemeModeChange={(themeMode) => updateSettings({ themeMode })}
            themeId={settings.themeId}
            customThemes={settings.customThemes}
            onThemeIdChange={(themeId) => updateSettings({ themeId })}
            onCustomThemesChange={(customThemes) => updateSettings({ customThemes })}
            themeSyncEnabled={settings.themeSyncEnabled}
            onThemeSyncEnabledChange={(themeSyncEnabled) => updateSettings({ themeSyncEnabled })}
            fullscreenMode={settings.fullscreenMode}
            onFullscreenModeChange={(fullscreenMode) => updateSettings({ fullscreenMode })}
            referenceNamePromptOnAdd={settings.referenceNamePromptOnAdd}
            onReferenceNamePromptOnAddChange={(referenceNamePromptOnAdd) => updateSettings({ referenceNamePromptOnAdd })}
            captureViewport={settings.captureViewport}
            onCaptureViewportChange={(captureViewport) => updateSettings({ captureViewport })}
            captureFullBlockThumbnail={settings.captureFullBlockThumbnail}
            onCaptureFullBlockThumbnailChange={(captureFullBlockThumbnail) => updateSettings({ captureFullBlockThumbnail })}
            sidePanelsHoverReveal={settings.sidePanelsHoverReveal}
            onSidePanelsHoverRevealChange={(sidePanelsHoverReveal) => updateSettings({ sidePanelsHoverReveal })}
            pinAction={pinAction}
          />
        )}
        {side === 'right' && <InspectorPanel pinAction={pinAction} />}
        {side === 'top' && <BrowserTopBarOverlayContent />}
        {side === 'references-left' && (
          <ReferencesSidebar
            onOpenSite={(url) => void window.api.referencesOverlayOpenSite(url)}
            onSelectReference={(projectId, url) => void window.api.referencesOverlaySelectSite(projectId, url)}
            themeMode={settings.themeMode}
            onThemeModeChange={(themeMode) => updateSettings({ themeMode })}
            themeId={settings.themeId}
            customThemes={settings.customThemes}
            onThemeIdChange={(themeId) => updateSettings({ themeId })}
            onCustomThemesChange={(customThemes) => updateSettings({ customThemes })}
            themeSyncEnabled={settings.themeSyncEnabled}
            onThemeSyncEnabledChange={(themeSyncEnabled) => updateSettings({ themeSyncEnabled })}
            fullscreenMode={settings.fullscreenMode}
            onFullscreenModeChange={(fullscreenMode) => updateSettings({ fullscreenMode })}
            referenceNamePromptOnAdd={settings.referenceNamePromptOnAdd}
            onReferenceNamePromptOnAddChange={(referenceNamePromptOnAdd) => updateSettings({ referenceNamePromptOnAdd })}
            captureViewport={settings.captureViewport}
            onCaptureViewportChange={(captureViewport) => updateSettings({ captureViewport })}
            captureFullBlockThumbnail={settings.captureFullBlockThumbnail}
            onCaptureFullBlockThumbnailChange={(captureFullBlockThumbnail) => updateSettings({ captureFullBlockThumbnail })}
            sidePanelsHoverReveal={settings.sidePanelsHoverReveal}
            onSidePanelsHoverRevealChange={(sidePanelsHoverReveal) => updateSettings({ sidePanelsHoverReveal })}
            pinAction={pinAction}
          />
        )}
        {side === 'references-right' && <ReferencesRightPanelOverlayContent pinAction={pinAction} />}
      </div>
    </ThemeProvider>
  )
}
