import { useEffect, useState } from 'react'
import { isValidThemeDef, ThemeProvider } from '@web-to-figma/ui'
import type { AppSettings } from '../../shared/types'
import { ApplyToSelectionContent } from './components/ApplyToSelectionContent'

/**
 * Смонтирован вместо `App` во ВТОРОМ renderer-процессе (`?overlay=1`, см.
 * main.tsx/main/overlay.ts) — собственный composited-слой НАД встроенным
 * браузером, куда рисуются попапы, которым нужно быть визуально поверх него
 * без hide/inset-компромиссов. Не разделяет React-дерево/состояние с `App` —
 * отдельный процесс, поэтому темизация читается из тех же `AppSettings`
 * независимо (theme mode здесь read-only, менять его можно только из
 * главного окна), а само содержимое (`content`) приходит через
 * `overlay:content`, которое транслирует main-процесс ОБОИМ рендерерам
 * одновременно — единственный источник правды про открытый попап.
 */
export function OverlayRoot(): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings({ ...s, customThemes: s.customThemes.filter(isValidThemeDef) }))
    return window.api.onOverlayContent(setContent)
  }, [])

  useEffect(() => {
    if (!content) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.overlayClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [content])

  if (!settings) return null

  return (
    <ThemeProvider
      mode={settings.themeMode}
      onModeChange={() => {}}
      themeId={settings.themeId}
      customThemes={settings.customThemes}
    >
      <div className="overlay-root">{content === 'apply-to-selection' && <ApplyToSelectionContent />}</div>
    </ThemeProvider>
  )
}
