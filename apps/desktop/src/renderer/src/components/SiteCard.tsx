import { Globe, Trash2 } from 'lucide-react'
import type { ProjectSite, StandaloneReferenceSite } from '../../../shared/types'

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface Props {
  /** Тот же набор полей есть и у ProjectSite, и у StandaloneReferenceSite
   *  (см. ReferencesView.tsx — карточки "Без проекта" на стартовом экране
   *  переиспользуют эту же карточку). Компонент читает только эти четыре
   *  поля, поэтому Pick вместо ProjectSite напрямую. */
  site: Pick<ProjectSite | StandaloneReferenceSite, 'url' | 'title' | 'faviconUrl' | 'thumbnail'>
  onClick: () => void
  /** Корзина в углу превью (по запросу пользователя) — опциональна: вызывающая
   *  сторона решает КАК удалить (projectsRemoveSite для сайта внутри проекта,
   *  standaloneReferencesRemove для "Без проекта", см. ReferencesView.tsx),
   *  сам компонент об этих API ничего не знает. */
  onRemove?: () => void
}

/** Карточка сайта внутри проекта в галерее "Референсы" (см.
 *  ReferencesView.tsx) — обычные сайты (kind:'site') обычно без thumbnail
 *  (снимается только для референсов, см. main/index.ts captureTabThumbnail),
 *  тогда показываем favicon-плейсхолдер на нейтральном фоне. */
export function SiteCard({ site, onClick, onRemove }: Props): JSX.Element {
  return (
    <button className="site-card" onClick={onClick} title={site.url}>
      <div className="site-card-cover">
        {site.thumbnail ? (
          <img src={site.thumbnail} alt="" />
        ) : (
          <span className="site-card-cover-fallback">
            {site.faviconUrl ? (
              <img className="site-card-favicon" src={site.faviconUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Globe size={28} />
            )}
          </span>
        )}
        {onRemove && (
          <span
            className="reference-item-cover-remove"
            title="Удалить"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={12} />
          </span>
        )}
      </div>
      <div className="site-card-body">
        <span className="site-card-title">{site.title || hostFromUrl(site.url)}</span>
        <span className="site-card-host">{hostFromUrl(site.url)}</span>
      </div>
    </button>
  )
}
