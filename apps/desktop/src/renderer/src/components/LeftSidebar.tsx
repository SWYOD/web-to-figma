import { useEffect, useState } from 'react'
import { Globe, Trash2, X } from 'lucide-react'
import { IconButton, Panel, PanelHead, PanelHeadActions, PanelTitle } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { QueueItemSummary, RecentSite } from '../../../shared/types'
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
  const [queueItems, setQueueItems] = useState<QueueItemSummary[]>([])

  useEffect(() => {
    window.api.recentSitesGet().then(setSites)
    return window.api.onRecentSitesUpdated(setSites)
  }, [])

  useEffect(() => {
    window.api.inspectorQueueGet().then(setQueueItems)
    return window.api.onInspectorQueueUpdated(setQueueItems)
  }, [])

  const handleRemove = (e: React.MouseEvent, url: string): void => {
    e.stopPropagation()
    window.api.recentSitesRemove(url)
  }

  const handleQueueItemRemove = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    window.api.inspectorQueueRemove(id)
  }

  const queueLabel = (item: QueueItemSummary): string =>
    item.element.id
      ? `${item.element.tag}#${item.element.id}`
      : item.element.classes[0]
        ? `${item.element.tag}.${item.element.classes[0]}`
        : item.element.tag

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

      {queueItems.length > 0 && (
        <>
          <PanelHead>
            <PanelTitle>Очередь ({queueItems.length})</PanelTitle>
            <PanelHeadActions>
              <IconButton title="Очистить очередь" onClick={() => window.api.inspectorQueueClear()}>
                <Trash2 size={14} />
              </IconButton>
            </PanelHeadActions>
          </PanelHead>
          <div className="recent-scroll queue-scroll">
            {queueItems.map((item) => (
              <div key={item.id} className="recent-row queue-row" title={queueLabel(item)}>
                <span className="recent-row-text">
                  <span className="recent-row-title">{queueLabel(item)}</span>
                  <span className="recent-row-host">
                    {item.element.width}×{item.element.height}
                  </span>
                </span>
                <span
                  className="icon-btn xs recent-row-remove"
                  title="Убрать из очереди"
                  onClick={(e) => handleQueueItemRemove(e, item.id)}
                >
                  <X size={12} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}

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
