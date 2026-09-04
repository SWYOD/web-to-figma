import { app } from 'electron'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { nanoid } from 'nanoid'
import type { CreateProjectInput, Project, ProjectsSnapshot, ProjectSite } from '../shared/types'

function projectsPath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

// Тот же readJson/writeJson паттерн, что и в recentSites.ts/index.ts —
// продублирован намеренно, см. комментарий в recentSites.ts про
// маленькие самодостаточные модули.
async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Проекты в левом сайдбаре ("объединять сайты в проекты, как чаты в Claude
 * Desktop", по запросу пользователя) — отдельное от RecentSitesStore
 * хранилище: тот пишет ЛЮБОЙ визит независимо от проектов (свободный от
 * этой логики "журнал"), а этот — намеренная организация пользователя.
 * Персистится в userData/projects.json как {projects: [...]}, а не голым
 * массивом (в отличие от recent-sites.json) — чтобы позже можно было
 * добавить версию схемы без breaking-миграции.
 */
export class ProjectsStore {
  private projects: Project[] = []

  constructor(private readonly onUpdate?: (snapshot: ProjectsSnapshot) => void) {}

  async load(): Promise<ProjectsSnapshot> {
    const stored = await readJson<{ projects: Project[] }>(projectsPath())
    this.projects = stored?.projects ?? []
    return this.getAll()
  }

  getAll(): ProjectsSnapshot {
    return { projects: this.projects }
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: nanoid(),
      name: input.name,
      createdAt: new Date().toISOString(),
      sites: [],
      ...(input.description ? { description: input.description } : {}),
      ...(input.icon ? { icon: input.icon } : {})
    }
    this.projects.push(project)
    await this.persist()
    return project
  }

  async renameProject(id: string, name: string): Promise<void> {
    const project = this.projects.find((p) => p.id === id)
    if (!project || project.name === name) return
    project.name = name
    await this.persist()
  }

  /** Редактирование проекта (по запросу пользователя — попап "..." на
   *  карточке, см. CreateProjectModal.tsx mode:'edit') — `icon`/`thumbnail`
   *  взаимоисключающие на уровне UI (вызывающая сторона шлёт `null` для
   *  очищаемого поля), `undefined` значит "не менять". */
  async updateProject(
    id: string,
    patch: { name?: string; description?: string; icon?: string | null; thumbnail?: string | null }
  ): Promise<void> {
    const project = this.projects.find((p) => p.id === id)
    if (!project) return
    if (patch.name !== undefined) project.name = patch.name
    if (patch.description !== undefined) project.description = patch.description || undefined
    if (patch.icon !== undefined) project.icon = patch.icon ?? undefined
    if (patch.thumbnail !== undefined) project.thumbnail = patch.thumbnail ?? undefined
    await this.persist()
  }

  async deleteProject(id: string): Promise<void> {
    const before = this.projects.length
    this.projects = this.projects.filter((p) => p.id !== id)
    if (this.projects.length !== before) await this.persist()
  }

  async reorderProjects(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.projects.map((p) => [p.id, p]))
    const reordered = orderedIds.map((id) => byId.get(id)).filter((p): p is Project => Boolean(p))
    // Проекты, не упомянутые в orderedIds (не должно случаться, но не
    // теряем данные молча, если фронт прислал неполный список), дописываем в конец.
    for (const p of this.projects) if (!orderedIds.includes(p.id)) reordered.push(p)
    this.projects = reordered
    await this.persist()
  }

  /** Дедуп внутри проекта — по точному url, не по хосту (в отличие от
   *  RecentSitesStore): проект осознанно может хотеть несколько разных
   *  страниц одного сайта как отдельные референсы/сайты. Повторное
   *  добавление уже существующего в проекте url — no-op. */
  async addSite(
    projectId: string,
    site: { url: string; title: string; faviconUrl: string | null },
    kind: 'site' | 'reference'
  ): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId)
    if (!project) return
    if (project.sites.some((s) => s.url === site.url)) return
    const entry: ProjectSite = { ...site, kind, addedAt: new Date().toISOString() }
    project.sites.push(entry)
    await this.persist()
  }

  async removeSite(projectId: string, url: string): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId)
    if (!project) return
    const before = project.sites.length
    project.sites = project.sites.filter((s) => s.url !== url)
    if (project.sites.length !== before) await this.persist()
  }

  /** Переключение "сайт" ⇄ "референс" НА МЕСТЕ, без смены проекта. */
  async moveSite(projectId: string, url: string, toKind: 'site' | 'reference'): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId)
    const site = project?.sites.find((s) => s.url === url)
    if (!site || site.kind === toKind) return
    site.kind = toKind
    await this.persist()
  }

  async moveSiteToProject(fromProjectId: string, toProjectId: string, url: string): Promise<void> {
    if (fromProjectId === toProjectId) return
    const from = this.projects.find((p) => p.id === fromProjectId)
    const to = this.projects.find((p) => p.id === toProjectId)
    const site = from?.sites.find((s) => s.url === url)
    if (!from || !to || !site) return
    if (to.sites.some((s) => s.url === url)) {
      from.sites = from.sites.filter((s) => s.url !== url)
      await this.persist()
      return
    }
    from.sites = from.sites.filter((s) => s.url !== url)
    to.sites.push(site)
    await this.persist()
  }

  async reorderSites(projectId: string, kind: 'site' | 'reference', orderedUrls: string[]): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId)
    if (!project) return
    const rest = project.sites.filter((s) => s.kind !== kind)
    const ofKind = project.sites.filter((s) => s.kind === kind)
    const byUrl = new Map(ofKind.map((s) => [s.url, s]))
    const reordered = orderedUrls.map((url) => byUrl.get(url)).filter((s): s is ProjectSite => Boolean(s))
    for (const s of ofKind) if (!orderedUrls.includes(s.url)) reordered.push(s)
    project.sites = [...rest, ...reordered]
    await this.persist()
  }

  async setThumbnail(projectId: string, url: string, thumbnail: string): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId)
    const site = project?.sites.find((s) => s.url === url)
    if (!site) return
    site.thumbnail = thumbnail
    await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJson(projectsPath(), { projects: this.projects })
    this.onUpdate?.(this.getAll())
  }
}
