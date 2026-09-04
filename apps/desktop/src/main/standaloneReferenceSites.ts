import { app } from 'electron'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import type { StandaloneReferenceSite } from '../shared/types'

function standaloneReferenceSitesPath(): string {
  return join(app.getPath('userData'), 'standalone-reference-sites.json')
}

// Тот же readJson/writeJson паттерн, что и в recentSites.ts/projects.ts/
// referenceItems.ts — продублирован намеренно (см. recentSites.ts докстринг
// про small focused modules).
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
 * Референс-сайты БЕЗ проекта (по запросу пользователя — "начать с сайта и
 * только потом оформить его как референс") — та же роль, что `Project.sites`
 * с `kind:'reference'`, только вне какого-либо проекта. Отдельный стор, а не
 * "виртуальный проект" внутри ProjectsStore — Project/ProjectSite типы и все
 * их IPC-методы рассчитаны на реальные проекты, заводить sentinel-id внутри
 * них потребовало бы правки всех этих мест ради частного случая.
 */
export class StandaloneReferenceSitesStore {
  private sites: StandaloneReferenceSite[] = []

  constructor(private readonly onUpdate?: (sites: StandaloneReferenceSite[]) => void) {}

  async load(): Promise<StandaloneReferenceSite[]> {
    this.sites = (await readJson<StandaloneReferenceSite[]>(standaloneReferenceSitesPath())) ?? []
    return this.sites
  }

  getAll(): StandaloneReferenceSite[] {
    return this.sites
  }

  /** Создаёт запись, если её ещё нет для этого url (см. "старт с URL" —
   *  reference:session-start сам вызывает upsert перед навигацией) —
   *  идемпотентно, повторный вызов для уже существующего url ничего не меняет. */
  async upsert(site: { url: string; title: string; faviconUrl: string | null }): Promise<StandaloneReferenceSite> {
    const existing = this.sites.find((s) => s.url === site.url)
    if (existing) return existing
    const entry: StandaloneReferenceSite = { ...site, addedAt: new Date().toISOString() }
    this.sites.push(entry)
    await this.persist()
    return entry
  }

  /** title/faviconUrl приходят от Electron ПОСЛЕ навигации (см.
   *  main/index.ts mountReferenceBrowser onTabsChange) — тот же паттерн, что
   *  RecentSitesStore.updateLatestMeta: uspert создаёт запись с пустым title
   *  ДО того, как страница реально загрузилась, это уточняет её постфактум. */
  async updateMeta(url: string, meta: { title?: string; faviconUrl?: string | null }): Promise<void> {
    const entry = this.sites.find((s) => s.url === url)
    if (!entry) return
    let changed = false
    if (meta.title !== undefined && meta.title !== entry.title) {
      entry.title = meta.title
      changed = true
    }
    if (meta.faviconUrl !== undefined && meta.faviconUrl !== entry.faviconUrl) {
      entry.faviconUrl = meta.faviconUrl
      changed = true
    }
    if (changed) await this.persist()
  }

  async remove(url: string): Promise<void> {
    const before = this.sites.length
    this.sites = this.sites.filter((s) => s.url !== url)
    if (this.sites.length !== before) await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJson(standaloneReferenceSitesPath(), this.sites)
    this.onUpdate?.(this.sites)
  }
}
