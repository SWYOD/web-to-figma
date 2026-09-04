import { useEffect, useState, type ReactNode } from 'react'
import { Globe, Plus, X } from 'lucide-react'
import { IconButton, Panel, PanelHead, PanelHeadActions, PanelTitle } from '@web-to-figma/ui'
import type { ThemeDef, ThemeMode } from '@web-to-figma/ui'
import type { AppSettings, Project, ProjectSite, StandaloneReferenceSite } from '../../../shared/types'
import { CreateProjectModal } from './CreateProjectModal'
import { ProjectSection } from './ProjectSection'
import { SettingsPopover } from './SettingsPopover'
import { packDragSite } from '../dragSite'

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface Props {
  onOpenSite: (url: string) => void
  onSelectReference: (projectId: string | null, url: string) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  themeId: string
  customThemes: ThemeDef[]
  onThemeIdChange: (id: string) => void
  onCustomThemesChange: (list: ThemeDef[]) => void
  themeSyncEnabled: boolean
  onThemeSyncEnabledChange: (enabled: boolean) => void
  fullscreenMode: AppSettings['fullscreenMode']
  onFullscreenModeChange: (mode: AppSettings['fullscreenMode']) => void
  referenceNamePromptOnAdd: boolean
  onReferenceNamePromptOnAddChange: (enabled: boolean) => void
  captureViewport: AppSettings['captureViewport']
  onCaptureViewportChange: (value: AppSettings['captureViewport']) => void
  captureFullBlockThumbnail: boolean
  onCaptureFullBlockThumbnailChange: (enabled: boolean) => void
  sidePanelsHoverReveal: boolean
  onSidePanelsHoverRevealChange: (enabled: boolean) => void
  /** Кнопка закрепления в distraction-free (см. ReferencesView.tsx, тот же
   *  паттерн, что LeftSidebar.tsx уже использует для основного браузера) —
   *  рендерится в шапке рядом с "Новый проект", не отдельным слоем. */
  pinAction?: ReactNode
}

/**
 * Левая панель навигации вкладки "Референсы" (по запросу пользователя —
 * замена хлебных крошек: выбор проекта/сайта теперь тут, а не
 * drill-down-кликами по карточкам, см. ReferencesView.tsx). Переиспользует
 * `ProjectSection.tsx` КАК ЕСТЬ (тот же компонент, что и в LeftSidebar.tsx
 * основного браузера) — клик по строке kind:'reference' идёт в
 * `onSelectReference` (переключает центр/правую колонку), а kind:'site'
 * остаётся `onOpenSite` (уходит в обычный браузер, как и раньше).
 *
 * Плюс блок "Без проекта" — референс-сайты без привязки к проекту, тот же
 * визуальный паттерн recent-row, что unsortedSites в LeftSidebar.tsx, и
 * кнопка "Настройки" внизу (эта панель — отдельная от LeftSidebar.tsx, без
 * неё настройки были бы недостижимы, пока открыта вкладка "Референсы" —
 * живой баг, поймал пользователь).
 */
export function ReferencesSidebar({
  onOpenSite,
  onSelectReference,
  themeMode,
  onThemeModeChange,
  themeId,
  customThemes,
  onThemeIdChange,
  onCustomThemesChange,
  themeSyncEnabled,
  onThemeSyncEnabledChange,
  fullscreenMode,
  onFullscreenModeChange,
  referenceNamePromptOnAdd,
  onReferenceNamePromptOnAddChange,
  captureViewport,
  onCaptureViewportChange,
  captureFullBlockThumbnail,
  onCaptureFullBlockThumbnailChange,
  sidePanelsHoverReveal,
  onSidePanelsHoverRevealChange,
  pinAction
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [standalone, setStandalone] = useState<StandaloneReferenceSite[]>([])
  const [creatingProject, setCreatingProject] = useState(false)

  useEffect(() => {
    window.api.projectsGet().then((s) => setProjects(s.projects))
    return window.api.onProjectsUpdated((s) => setProjects(s.projects))
  }, [])

  useEffect(() => {
    window.api.standaloneReferencesGet().then(setStandalone)
    return window.api.onStandaloneReferencesUpdated(setStandalone)
  }, [])

  // Новый проект разворачиваем сразу — тот же приём, что LeftSidebar.tsx.
  useEffect(() => {
    setExpandedProjects((current) => {
      const missing = projects.filter((p) => !current.has(p.id))
      if (missing.length === 0) return current
      const next = new Set(current)
      for (const p of missing) next.add(p.id)
      return next
    })
  }, [projects])

  const handleNavigate = (project: Project, url: string): void => {
    const site = project.sites.find((s) => s.url === url)
    if (site?.kind === 'reference') onSelectReference(project.id, url)
    else onOpenSite(url)
  }

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Референсы</PanelTitle>
        <PanelHeadActions>
          <IconButton title="Новый проект" onClick={() => setCreatingProject(true)}>
            <Plus size={14} />
          </IconButton>
          {pinAction}
        </PanelHeadActions>
      </PanelHead>

      <div className="recent-scroll">
        {projects.map((p) => (
          <ProjectSection
            key={p.id}
            project={p}
            expanded={expandedProjects.has(p.id)}
            onToggleExpanded={() =>
              setExpandedProjects((current) => {
                const next = new Set(current)
                if (next.has(p.id)) next.delete(p.id)
                else next.add(p.id)
                return next
              })
            }
            onNavigate={(url) => handleNavigate(p, url)}
            onNewTab={(url) => window.api.browserNewTab(url)}
            onRename={(name) => window.api.projectsRename(p.id, name)}
            onDelete={() => window.api.projectsDelete(p.id)}
            onRemoveSite={(url) => window.api.projectsRemoveSite(p.id, url)}
            onToggleKind={(url, currentKind: ProjectSite['kind']) =>
              window.api.projectsMoveSiteKind(p.id, url, currentKind === 'site' ? 'reference' : 'site')
            }
            onDropSite={async (dragged, toKind) => {
              if (dragged.fromStandalone) {
                // Переносит и уже собранные ReferenceItem этого сайта — см.
                // main/index.ts standalone-references:attach-to-project.
                // Итог всегда kind:'reference' (standalone-записи и так
                // только референсы, третьего пути тут нет).
                await window.api.standaloneReferencesAttachToProject(dragged.url, p.id)
              } else if (dragged.fromProjectId) {
                await window.api.projectsMoveSiteToProject(dragged.fromProjectId, p.id, dragged.url)
                await window.api.projectsMoveSiteKind(p.id, dragged.url, toKind)
              } else {
                await window.api.projectsAddSite(p.id, { url: dragged.url, title: dragged.title, faviconUrl: dragged.faviconUrl }, toKind)
              }
            }}
          />
        ))}

        <div className="sidebar-section-label">Без проекта</div>
        {standalone.length === 0 && (
          <div className="placeholder-hint recent-empty">Начните с поиска сайта сверху — он появится здесь.</div>
        )}
        {standalone.map((s) => (
          <button
            key={s.url}
            className="recent-row"
            title={s.url}
            draggable
            onDragStart={(e) => packDragSite(e, { url: s.url, title: s.title, faviconUrl: s.faviconUrl, fromStandalone: true })}
            onClick={() => onSelectReference(null, s.url)}
          >
            {s.thumbnail ? (
              <img className="recent-row-favicon project-site-thumb" src={s.thumbnail} alt="" />
            ) : s.faviconUrl ? (
              <img className="recent-row-favicon" src={s.faviconUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Globe size={14} className="recent-row-favicon-fallback" />
            )}
            <span className="recent-row-text">
              <span className="recent-row-title">{s.title || hostFromUrl(s.url)}</span>
              <span className="recent-row-host">{hostFromUrl(s.url)}</span>
            </span>
            <span
              className="icon-btn xs recent-row-remove"
              title="Удалить"
              onClick={(e) => {
                e.stopPropagation()
                void window.api.standaloneReferencesRemove(s.url)
              }}
            >
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
        themeSyncEnabled={themeSyncEnabled}
        onThemeSyncEnabledChange={onThemeSyncEnabledChange}
        fullscreenMode={fullscreenMode}
        onFullscreenModeChange={onFullscreenModeChange}
        referenceNamePromptOnAdd={referenceNamePromptOnAdd}
        onReferenceNamePromptOnAddChange={onReferenceNamePromptOnAddChange}
        captureViewport={captureViewport}
        onCaptureViewportChange={onCaptureViewportChange}
        captureFullBlockThumbnail={captureFullBlockThumbnail}
        onCaptureFullBlockThumbnailChange={onCaptureFullBlockThumbnailChange}
        sidePanelsHoverReveal={sidePanelsHoverReveal}
        onSidePanelsHoverRevealChange={onSidePanelsHoverRevealChange}
      />

      {creatingProject && (
        <CreateProjectModal
          onClose={() => setCreatingProject(false)}
          onSubmit={(input) => {
            setCreatingProject(false)
            void window.api.projectsCreate(input)
          }}
        />
      )}
    </Panel>
  )
}
