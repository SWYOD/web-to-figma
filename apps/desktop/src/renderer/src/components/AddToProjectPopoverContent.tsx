import { useEffect, useState } from 'react'
import { Plus, Star } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  site: { url: string; title: string; faviconUrl: string | null }
}

/**
 * Содержимое попапа "Добавить в проект" — живёт в popover-overlay-рендерере
 * (см. PopoverOverlayRoot.tsx), не в главном окне. Добавление в СУЩЕСТВУЮЩИЙ
 * проект — обычный window.api-вызов прямо отсюда (у overlay-рендерера тот же
 * доступ к preload API, что и у главного окна). "Новый проект" — единственное
 * исключение: открывает CreateProjectModal, большой центрированный модал,
 * который не поместился бы в маленький popover-слой — вместо рендера здесь
 * шлёт popoverAction главному окну (см. AddToProjectButton.tsx), которое и
 * открывает модалку у себя.
 */
export function AddToProjectPopoverContent({ site }: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    window.api.projectsGet().then((s) => setProjects(s.projects))
    return window.api.onProjectsUpdated((s) => setProjects(s.projects))
  }, [])

  const addTo = (projectId: string, kind: 'site' | 'reference'): void => {
    window.api.projectsAddSite(projectId, site, kind)
    void window.api.overlayClosePopover()
  }

  return (
    <div className="popover">
      <div className="settings-section">
        <span className="settings-label">Добавить в проект</span>
        {projects.length === 0 && <p className="add-to-project-empty">Проектов пока нет.</p>}
        {projects.map((p) => (
          <div key={p.id} className="add-to-project-row">
            <button className="settings-row settings-row-btn add-to-project-name" onClick={() => addTo(p.id, 'site')}>
              {p.name}
            </button>
            <button className="icon-btn xs" title="Добавить как референс" onClick={() => addTo(p.id, 'reference')}>
              <Star size={13} />
            </button>
          </div>
        ))}
        <button
          className="settings-row settings-row-btn"
          onClick={() => void window.api.popoverAction({ type: 'add-to-project:create-project' })}
        >
          <Plus size={13} /> Новый проект
        </button>
      </div>
    </div>
  )
}
