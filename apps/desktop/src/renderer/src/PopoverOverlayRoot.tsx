import { useEffect, useRef, useState } from 'react'
import { isValidThemeDef, ThemeProvider } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { AddToProjectPopoverContent } from './components/AddToProjectPopoverContent'
import { ReferenceNamePopoverContent } from './components/ReferenceNamePopoverContent'

interface Shown {
  kind: string
  props: unknown
}

/**
 * Смонтирован вместо `App`/`OverlayRoot` в ТРЕТЬЕМ overlay-слое (`?overlay=popover`,
 * см. main/overlay.ts OverlayController — теперь менеджер НЕСКОЛЬКИХ независимых
 * слоёв, не один). Generic контейнер для любого попапа, который должен рисоваться
 * реально НАД встроенным браузером без прятанья его через browserSetHidden — по
 * запросу пользователя, вместо usePopoverVisibility-подхода для КАЖДОГО такого
 * попапа отдельно. Какой именно попап показать — решает `kind` из `popover:show`
 * (см. main/index.ts `overlay:popover-open`), эта развилка — единственное место,
 * которое трогает следующий попап; вся проводка open/close/reposition уже общая.
 */
export function PopoverOverlayRoot(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const stackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings({ ...s, customThemes: s.customThemes.filter(isValidThemeDef) }))
  }, [])

  useEffect(() => window.api.onPopoverShow(setShown), [])

  // Esc внутри самого попапа — main закроет слой и разошлёт overlay:popover-closed,
  // на который открывшая кнопка (см. AddToProjectButton.tsx) синхронизирует свой
  // локальный "открыт ли" state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.overlayClosePopover()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Реальный размер контента заранее неизвестен (зависит от kind/props) —
  // измеряем сами и шлём main'у, тот пересчитывает bounds так, чтобы попап
  // оставался у своего якоря независимо от фактической ширины/высоты (тот же
  // паттерн, что у плавающего тулбара пикера, см. OverlayRoot.tsx).
  useEffect(() => {
    const el = stackRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      window.api.overlayPopoverReportSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [settings, shown])

  if (!settings || !shown) return null

  return (
    <ThemeProvider mode={settings.themeMode} onModeChange={() => {}} themeId={settings.themeId} customThemes={settings.customThemes}>
      <div className="popover-overlay-root">
        <div ref={stackRef} className="popover-overlay-stack">
          {shown.kind === 'add-to-project' && <AddToProjectPopoverContent {...(shown.props as { site: { url: string; title: string; faviconUrl: string | null } })} />}
          {shown.kind === 'reference-name' && <ReferenceNamePopoverContent {...(shown.props as { label: string })} />}
        </div>
      </div>
    </ThemeProvider>
  )
}
