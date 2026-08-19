import { Globe, Loader2, Plus, X } from 'lucide-react'
import type { TabState } from '../../../shared/types'

// Стартовая страница — свой data: URL (см. main/startPage.ts), показываем
// человеческое имя вместо сырого data:text/html;... в заголовке вкладки.
const isStartPage = (url: string): boolean => url.startsWith('data:text/html')

interface BrowserTabBarProps {
  tabs: TabState[]
  activeTabId: string | null
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onNewTab: () => void
}

/**
 * Вкладки встроенного браузера — по запросу пользователя ("усилить браузер,
 * работать с несколькими сайтами сразу"). Каждая вкладка — отдельный
 * `WebContentsView` в main (см. main/browser.ts), сохраняющий реальное
 * состояние страницы (scroll/JS/форма) при переключении, а не просто URL.
 */
export function BrowserTabBar({ tabs, activeTabId, onSwitch, onClose, onNewTab }: BrowserTabBarProps): JSX.Element {
  return (
    <div className="browser-tab-bar">
      <div className="browser-tab-list">
        {tabs.map((tab) => {
          const title = isStartPage(tab.url) ? 'Новая вкладка' : tab.title || tab.url || 'Загрузка…'
          return (
            <div
              key={tab.id}
              className={`browser-tab${tab.id === activeTabId ? ' active' : ''}`}
              onClick={() => onSwitch(tab.id)}
              title={title}
            >
              {tab.isLoading ? (
                <Loader2 size={12} className="spin browser-tab-icon" />
              ) : tab.faviconUrl ? (
                <img
                  className="browser-tab-favicon"
                  src={tab.faviconUrl}
                  alt=""
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              ) : (
                <Globe size={12} className="browser-tab-icon" />
              )}
              <span className="browser-tab-title">{title}</span>
              <span
                className="browser-tab-close"
                title="Закрыть вкладку"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <X size={12} />
              </span>
            </div>
          )
        })}
      </div>
      <span className="browser-tab-new" title="Новая вкладка" onClick={onNewTab}>
        <Plus size={14} />
      </span>
    </div>
  )
}
