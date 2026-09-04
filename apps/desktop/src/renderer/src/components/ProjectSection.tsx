import { useState, type DragEvent as ReactDragEvent } from 'react'
import { ChevronDown, ChevronRight, Folder, Globe, MoreHorizontal, Star, X } from 'lucide-react'
import { Popover } from '@web-to-figma/ui'
import type { Project, ProjectSite } from '../../../shared/types'
import { PROJECT_ICON_MAP } from './CreateProjectModal'
import { packDragSite, unpackDragSite, type DraggedSite } from '../dragSite'

/** Короткое "host" из URL — тот же хелпер, что и в LeftSidebar.tsx (там же
 *  используется для несортированного списка). */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface Props {
  project: Project
  expanded: boolean
  onToggleExpanded: () => void
  onNavigate: (url: string) => void
  onNewTab: (url: string) => void
  onRename: (name: string) => void
  onDelete: () => void
  onRemoveSite: (url: string) => void
  onToggleKind: (url: string, currentKind: ProjectSite['kind']) => void
  /** Дроп сайта — из несортированного списка (без fromProjectId) или из
   *  другого проекта (см. dragSite.ts). `toKind` — куда именно уронили:
   *  на заголовок проекта (дефолт 'site') или прямо в группу "Сайты"/
   *  "Референсы" (по запросу пользователя — раньше можно было уронить
   *  ТОЛЬКО на заголовок, и оно ВСЕГДА добавлялось как 'site', даже когда
   *  визуально целились в группу "Референсы" — живой баг, "драг н дроп не
   *  работает"). */
  onDropSite: (site: DraggedSite, toKind: ProjectSite['kind']) => void
}

/** Один проект в сайдбаре — заголовок (раскрытие/переименование/удаление) +
 *  две подсекции "Сайты"/"Референсы" (см. main/projects.ts ProjectSite.kind),
 *  по запросу пользователя — "разделить взаимодействие на две части". */
export function ProjectSection({
  project,
  expanded,
  onToggleExpanded,
  onNavigate,
  onNewTab,
  onRename,
  onDelete,
  onRemoveSite,
  onToggleKind,
  onDropSite
}: Props): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [menuOpen, setMenuOpen] = useState(false)
  // Какая именно зона сейчас под drag — заголовок ('head') или конкретная
  // группа ('site'/'reference', см. onDropSite докстринг) — раздельная
  // подсветка, не один общий boolean на весь проект.
  const [dragOverZone, setDragOverZone] = useState<'head' | ProjectSite['kind'] | null>(null)

  const dropHandlers = (zone: 'head' | ProjectSite['kind']): {
    onDragOver: (e: ReactDragEvent) => void
    onDragEnter: (e: ReactDragEvent) => void
    onDragLeave: (e: ReactDragEvent) => void
    onDrop: (e: ReactDragEvent) => void
  } => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes('application/x-w2f-site')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragEnter: (e) => {
      if (!e.dataTransfer.types.includes('application/x-w2f-site')) return
      setDragOverZone(zone)
    },
    // relatedTarget — куда указатель ушёл ПРИ выходе; dragenter/dragleave
    // всплывают на КАЖДОЙ границе дочернего элемента внутри зоны (иконки,
    // текст строк) — без этой проверки курсор, просто идущий по строкам
    // внутри уже наведённой группы, гасил и тут же переставлял подсветку на
    // каждой границе — живой баг, поймал пользователь ("обводка
    // мерцает/ломано появляется"). Игнорируем dragleave, если ушли на
    // элемент, который всё ещё ВНУТРИ этой же зоны (currentTarget).
    onDragLeave: (e) => {
      const related = e.relatedTarget as Node | null
      if (related && e.currentTarget.contains(related)) return
      setDragOverZone((z) => (z === zone ? null : z))
    },
    onDrop: (e) => {
      setDragOverZone(null)
      const dragged = unpackDragSite(e)
      if (!dragged || dragged.fromProjectId === project.id) return
      e.preventDefault()
      onDropSite(dragged, zone === 'head' ? 'site' : zone)
    }
  })

  const sites = project.sites.filter((s) => s.kind === 'site')
  const references = project.sites.filter((s) => s.kind === 'reference')

  const commitRename = (): void => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== project.name) onRename(trimmed)
    setRenaming(false)
  }

  const renderRow = (site: ProjectSite): JSX.Element => (
    <button
      key={site.url}
      className="recent-row"
      title={site.url}
      draggable
      onDragStart={(e) =>
        packDragSite(e, { url: site.url, title: site.title, faviconUrl: site.faviconUrl, fromProjectId: project.id })
      }
      onClick={() => onNavigate(site.url)}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onNewTab(site.url)
      }}
    >
      {site.thumbnail ? (
        <img className="recent-row-favicon project-site-thumb" src={site.thumbnail} alt="" />
      ) : site.faviconUrl ? (
        <img className="recent-row-favicon" src={site.faviconUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
      ) : (
        <Globe size={14} className="recent-row-favicon-fallback" />
      )}
      <span className="recent-row-text">
        <span className="recent-row-title">{site.title || hostFromUrl(site.url)}</span>
        <span className="recent-row-host">{hostFromUrl(site.url)}</span>
      </span>
      <span
        className="icon-btn xs recent-row-remove"
        title={site.kind === 'site' ? 'Сделать референсом' : 'Сделать обычным сайтом'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleKind(site.url, site.kind)
        }}
      >
        <Star size={12} fill={site.kind === 'reference' ? 'currentColor' : 'none'} />
      </span>
      <span
        className="icon-btn xs recent-row-remove"
        title="Убрать из проекта"
        onClick={(e) => {
          e.stopPropagation()
          onRemoveSite(site.url)
        }}
      >
        <X size={12} />
      </span>
    </button>
  )

  return (
    <div className="project-section">
      <div className={`project-section-head${dragOverZone === 'head' ? ' drag-over' : ''}`} {...dropHandlers('head')}>
        <button className="project-section-toggle" onClick={onToggleExpanded}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="project-section-icon">
          {(() => {
            const IconComp = (project.icon && PROJECT_ICON_MAP[project.icon]) || Folder
            return <IconComp size={13} />
          })()}
        </span>
        {renaming ? (
          <input
            className="project-section-rename-input"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraftName(project.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <span className="project-section-name" title={project.description} onDoubleClick={() => setRenaming(true)}>
            {project.name}
          </span>
        )}
        <span className="project-section-count">{project.sites.length}</span>
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchor={
            <button className="icon-btn xs" title="Действия с проектом" onClick={() => setMenuOpen((v) => !v)}>
              <MoreHorizontal size={13} />
            </button>
          }
        >
          <button
            className="settings-row settings-row-btn"
            onClick={() => {
              setMenuOpen(false)
              setRenaming(true)
            }}
          >
            Переименовать
          </button>
          <button
            className="settings-row settings-row-btn project-section-menu-danger"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
          >
            Удалить проект
          </button>
        </Popover>
      </div>

      {expanded && (
        <>
          {/* Обе группы теперь ВСЕГДА в DOM, даже пустые (по запросу
              пользователя — раньше пустую "Референсы" нечем было поймать
              дропом, группа просто не рендерилась вовсе, живой баг "драг н
              дроп не работает") — своя drop-зона на каждой, отдельно от
              заголовка, чтобы можно было прицельно перетащить именно в
              "Референсы", а не только на весь проект с дефолтным 'site'. */}
          <div
            className={`project-section-group${dragOverZone === 'site' ? ' drag-over' : ''}`}
            {...dropHandlers('site')}
          >
            <div className="project-section-group-label">Сайты</div>
            {sites.length > 0 ? sites.map(renderRow) : <div className="project-section-group-empty">Перетащите сайт сюда</div>}
          </div>
          <div
            className={`project-section-group${dragOverZone === 'reference' ? ' drag-over' : ''}`}
            {...dropHandlers('reference')}
          >
            <div className="project-section-group-label">Референсы</div>
            {references.length > 0 ? (
              references.map(renderRow)
            ) : (
              <div className="project-section-group-empty">Перетащите сайт сюда</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
