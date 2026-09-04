import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'

/**
 * "Прикрепить к проекту" (по запросу пользователя — сайт, начатый с поиска
 * без проекта, можно оформить в проект позже) — простой список кнопок под
 * галереей, тот же смысл, что AddToProjectPopoverContent.tsx, но без
 * попап-слоя. Список проектов читает сама (не пропом) — переиспользуется и
 * инлайн в ReferencesView.tsx (главное окно), и в плавающей правой колонке
 * (ReferencesRightPanelOverlayContent.tsx, ОТДЕЛЬНЫЙ renderer-процесс, где
 * пропа от ReferencesView.tsx просто нет), тот же паттерн, что уже
 * ReferenceItemsPanel/ReferencesSidebar самодостаточны через window.api.
 */
export function AttachToProjectRow({ url }: { url: string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    window.api.projectsGet().then((s) => setProjects(s.projects))
    return window.api.onProjectsUpdated((s) => setProjects(s.projects))
  }, [])

  if (projects.length === 0) return null

  if (!open) {
    return (
      <button className="reference-attach-toggle" onClick={() => setOpen(true)}>
        Прикрепить к проекту
      </button>
    )
  }
  return (
    <div className="reference-attach-list">
      {projects.map((p) => (
        <button
          key={p.id}
          className="settings-row settings-row-btn"
          onClick={() => {
            setOpen(false)
            void window.api.standaloneReferencesAttachToProject(url, p.id)
          }}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}
