import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Globe, Loader2, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import { IconButton } from '@web-to-figma/ui'
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
  distractionFree: boolean
  onToggleDistractionFree: () => void
  /** См. LeftSidebar.tsx Props.pinAction — pin для верхней float-панели
   *  (по запросу пользователя, "в любом полноэкранном режиме"), рендерится
   *  сюда же, в блок действий рядом с переключателем полноэкранного режима. */
  pinAction?: ReactNode
  /** Встроенный референс-браузер (см. ReferenceBrowserPane.tsx) не
   *  поддерживает distraction-free — кнопка не должна висеть мёртвым грузом. */
  hideFullscreenToggle?: boolean
}

/**
 * Вкладки встроенного браузера — по запросу пользователя ("усилить браузер,
 * работать с несколькими сайтами сразу"). Каждая вкладка — отдельный
 * `WebContentsView` в main (см. main/browser.ts), сохраняющий реальное
 * состояние страницы (scroll/JS/форма) при переключении, а не просто URL.
 */
export function BrowserTabBar({
  tabs,
  activeTabId,
  onSwitch,
  onClose,
  onNewTab,
  distractionFree,
  onToggleDistractionFree,
  pinAction,
  hideFullscreenToggle
}: BrowserTabBarProps): JSX.Element {
  // .browser-tab-list скроллится (overflow-x:auto), когда даже сжатые до
  // min-width вкладки не помещаются (см. styles.css) — без этого активная
  // вкладка (обычно последняя/только что созданная) могла остаться ЧАСТИЧНО
  // за пределами видимой прокрученной области: DOM-бокс существует целиком,
  // но зрительно обрезан границей overflow, из-за чего иконка выглядит
  // "раздутой"/нецентрированной (живой баг, поймал пользователь). Обычные
  // браузеры всегда доскролливают активную вкладку в видимую область — тот
  // же scrollIntoView здесь.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.browser-tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeTabId, tabs.length])

  return (
    <div className="browser-tab-bar">
      <div className="browser-tab-list" ref={listRef}>
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
      <div className="browser-tab-bar-actions">
        {pinAction}
        {!hideFullscreenToggle && (
          <IconButton
            active={distractionFree}
            onClick={onToggleDistractionFree}
            title={distractionFree ? 'Выключить полноэкранный режим' : 'Полноэкранный режим'}
          >
            {distractionFree ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
        )}
      </div>
    </div>
  )
}
