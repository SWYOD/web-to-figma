import { useState } from 'react'
import { Folder, MoreHorizontal } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { CreateProjectModal, PROJECT_ICON_MAP } from './CreateProjectModal'

interface Props {
  project: Project
  onClick: () => void
}

/** Упрощённая (не идеальная для всех чисел, но не режет глаз в типичном
 *  диапазоне 0-99) русская плюрализация "N сайт/сайта/сайтов". */
function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** Карточка проекта в галерее "Референсы" (см. ReferencesView.tsx) —
 *  обложка = своя картинка проекта (см. Project.thumbnail), иначе превью
 *  первого референса с thumbnail, иначе плейсхолдер. Угловая кнопка "..."
 *  (по запросу пользователя) открывает CreateProjectModal в режиме
 *  редактирования — тот же попап, что и создание, просто предзаполненный. */
export function ProjectCard({ project, onClick }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const cover = project.thumbnail ?? project.sites.find((s) => s.thumbnail)?.thumbnail
  const siteCount = project.sites.filter((s) => s.kind === 'site').length
  const referenceCount = project.sites.filter((s) => s.kind === 'reference').length
  const IconComp = (project.icon && PROJECT_ICON_MAP[project.icon]) || Folder

  return (
    <div className="project-card-wrap">
      <button className="project-card" onClick={onClick}>
        <div className="project-card-cover">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span className="project-card-cover-fallback">
              <IconComp size={32} />
            </span>
          )}
        </div>
        <div className="project-card-body">
          <span className="project-card-name">{project.name}</span>
          {project.description && <span className="project-card-description">{project.description}</span>}
          <span className="project-card-meta">
            {siteCount} {pluralize(siteCount, 'сайт', 'сайта', 'сайтов')}
            {referenceCount > 0 ? `, ${referenceCount} ${pluralize(referenceCount, 'референс', 'референса', 'референсов')}` : ''}
          </span>
        </div>
      </button>
      <button
        className="project-card-menu-btn"
        title="Настройки проекта"
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {editing && (
        <CreateProjectModal
          initial={{ name: project.name, description: project.description, icon: project.icon, thumbnail: project.thumbnail }}
          onClose={() => setEditing(false)}
          onSubmit={(input) => {
            setEditing(false)
            void window.api.projectsUpdate(project.id, {
              name: input.name,
              description: input.description ?? '',
              icon: input.icon ?? null,
              thumbnail: input.thumbnail ?? null
            })
          }}
        />
      )}
    </div>
  )
}
