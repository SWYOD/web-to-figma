import { useEffect, useState } from 'react'
import { Globe, X } from 'lucide-react'
import { Panel, PanelHead, PanelTitle } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { RecentSite } from '../../../shared/types'
import { SettingsPopover } from './SettingsPopover'

interface Props {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
}

/** Короткое "host" из URL для подписи под названием — если распарсить не
 *  вышло (маловероятно, URL уже прошёл normalizeUrlInput в main), просто
 *  показываем сам URL как есть. */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Левый сайдбар — история недавно посещённых сайтов встроенного браузера
 * (аналога в Skill-tree нет, дерево навыков там; см. docs/design-system.md §7)
 * + кнопка "Настройки", пришпиленная к низу (визуальный паттерн 1:1 из
 * LeftPanel.tsx Skill-tree: `.panel.left-panel` > шапка > скроллящийся список
 * > `.settings-anchor`).
 */
export function LeftSidebar({
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange
}: Props): JSX.Element {
  const [sites, setSites] = useState<RecentSite[]>([])

  useEffect(() => {
    window.api.recentSitesGet().then(setSites)
    return window.api.onRecentSitesUpdated(setSites)
  }, [])

  const handleRemove = (e: React.MouseEvent, url: string): void => {
    e.stopPropagation()
    window.api.recentSitesRemove(url)
  }

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Недавние</PanelTitle>
      </PanelHead>

      <div className="recent-scroll">
        {sites.length === 0 && (
          <div className="placeholder-hint recent-empty">Здесь появится история посещённых сайтов.</div>
        )}
        {sites.map((s) => (
          <button
            key={s.url}
            className="recent-row"
            title={s.url}
            onClick={() => window.api.browserNavigate(s.url)}
            // Средняя кнопка — как в обычном браузере: открыть в новой
            // вкладке, а не в текущей (по запросу пользователя). `<button>`
            // не эмитит `onClick` на среднем клике вообще (только левый), но
            // САМ auxclick с button===1 браузер шлёт — здесь его и ловим.
            onAuxClick={(e) => {
              if (e.button !== 1) return
              e.preventDefault()
              window.api.browserNewTab(s.url)
            }}
          >
            {s.faviconUrl ? (
              <img className="recent-row-favicon" src={s.faviconUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Globe size={14} className="recent-row-favicon-fallback" />
            )}
            <span className="recent-row-text">
              <span className="recent-row-title">{s.title || hostFromUrl(s.url)}</span>
              <span className="recent-row-host">{hostFromUrl(s.url)}</span>
            </span>
            <span className="icon-btn xs recent-row-remove" title="Убрать из истории" onClick={(e) => handleRemove(e, s.url)}>
              <X size={12} />
            </span>
          </button>
        ))}
      </div>

      <SettingsPopover
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        themeId={themeId}
        customThemes={customThemes}
        onThemeIdChange={onThemeIdChange}
        onCustomThemesChange={onCustomThemesChange}
      />
    </Panel>
  )
}
