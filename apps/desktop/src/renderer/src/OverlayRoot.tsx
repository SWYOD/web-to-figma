import { useEffect, useRef, useState } from 'react'
import { isValidThemeDef, ThemeProvider } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { ApplyToSelectionContent } from './components/ApplyToSelectionContent'
import { PickerFloatBar } from './components/PickerFloatBar'

/**
 * Смонтирован вместо `App` во ВТОРОМ renderer-процессе (`?overlay=1`, см.
 * main.tsx/main/overlay.ts) — собственный composited-слой НАД встроенным
 * браузером. Раньше показывал ОДИН попап "по требованию" (Apply to
 * Selection, открытый/закрытый через `overlay:open`/`overlay:close`); теперь
 * здесь ПОСТОЯННО живёт плавающий тулбар (`PickerFloatBar`, см. его же
 * докстринг) — по запросу пользователя браузер должен занимать всю область
 * без зарезервированной снизу полосы. Apply to Selection остался внутри как
 * обычный ЛОКАЛЬНЫЙ React state (`applyOpen`) — больше не нужен отдельный
 * IPC-канал "какой попап открыт", раз тулбар и попап всегда в одном и том же
 * React-дереве.
 */
export function OverlayRoot(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const stackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings({ ...s, customThemes: s.customThemes.filter(isValidThemeDef) }))
    window.api.inspectorGetLastSelection().then((result) => {
      if (result) setHasSelection(true)
    })
    const offSelection = window.api.onInspectorSelection(() => setHasSelection(true))
    // Клик В САМУ страницу (другой webContents) — единственный способ узнать
    // о "клике снаружи" popover'а, раз тот теперь не в этом же окне (см.
    // main/index.ts, BrowserController onFocus).
    const offCollapse = window.api.onOverlayCollapsePopover(() => setApplyOpen(false))
    return () => {
      offSelection()
      offCollapse()
    }
  }, [])

  useEffect(() => {
    if (!applyOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setApplyOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyOpen])

  // Реальные размеры стека (тулбар + опционально раскрытый popover, +
  // подпись статуса пикера переменной длины вроде "Кликните на элемент
  // страницы") заранее неизвестны — измеряем сами и шлём main'у (см. index.ts
  // repositionToolbarOverlay), тот пересчитывает bounds так, чтобы низ
  // тулбара оставался прижат к низу браузера, а сам он — по центру, какой бы
  // ни была фактическая ширина. И ширина, и высота — раньше ширина overlay-
  // окна была захардкожена константой, из-за чего контент шире нее обрезался/
  // скроллился внутри фиксированных bounds WebContentsView (живой баг).
  // ВАЖНО: deps включает `settings` — компонент рендерит `null` (пустой DOM),
  // пока settings не загрузились (см. `if (!settings) return null` ниже), а
  // ref на `.overlay-toolbar-stack` появляется только ПОСЛЕ этого. С пустым
  // `[]` deps этот эффект выполнился бы РОВНО РАЗ, на самом первом (пустом)
  // рендере, увидел бы `stackRef.current === null` и вышел — ResizeObserver
  // никогда бы не подписался вообще (живой баг: main никогда не получал
  // `overlay:report-size`, ширина/высота overlay-окна навсегда оставались на
  // стартовой оценке-заглушке — контент шире неё обрезался/скроллился).
  useEffect(() => {
    const el = stackRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      window.api.overlayReportSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [settings])

  if (!settings) return null

  return (
    <ThemeProvider
      mode={settings.themeMode}
      onModeChange={() => {}}
      themeId={settings.themeId}
      customThemes={settings.customThemes}
    >
      <div className="overlay-root">
        <div ref={stackRef} className="overlay-toolbar-stack">
          {applyOpen && <ApplyToSelectionContent />}
          <PickerFloatBar applyOpen={applyOpen} onToggleApply={() => setApplyOpen((v) => !v)} applyDisabled={!hasSelection} />
        </div>
      </div>
    </ThemeProvider>
  )
}
