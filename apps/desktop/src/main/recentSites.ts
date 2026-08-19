import { app } from 'electron'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { isStartPage } from './startPage'
import type { RecentSite } from '../shared/types'

const CAP = 40

/** "Сайт" в истории — домен, не отдельная страница (см. `recordVisit`) —
 *  иначе разные страницы одного сайта плодят отдельные записи в "Recent",
 *  хотя UI (`LeftSidebar.tsx`) и так уже показывает hostname как подпись,
 *  подразумевая один сайт = одна запись. При ошибке парсинга (не должно
 *  случаться — url уже прошёл normalizeUrlInput до этой точки) возвращает
 *  сам url как ключ — деградирует к прежнему "одна запись на URL", не падает. */
function siteKey(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function recentSitesPath(): string {
  return join(app.getPath('userData'), 'recent-sites.json')
}

// Тот же двухстрочный readJson/writeJson паттерн, что и в index.ts (settings.json/
// bridge.json) — продублирован здесь намеренно, а не импортирован из index.ts,
// чтобы этот модуль оставался маленьким/самодостаточным (см. docs/development.md
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
 * История посещённых в embedded-браузере URL — capped/deduped/most-recent-first,
 * персистится в userData (аналог settings.json). Изолирован от IPC — index.ts
 * вызывает методы и подписывается на onUpdate, тот же паттерн, что
 * BrowserController/ElementPicker (см. их конструкторы: колбэки, а не прямой
 * импорт ipcMain/electron внутри самой бизнес-логики... кроме app.getPath,
 * который неизбежен здесь же ради простоты — весь остальной модуль fs-only).
 */
export class RecentSitesStore {
  private list: RecentSite[] = []

  constructor(private readonly onUpdate?: (list: RecentSite[]) => void) {}

  async load(): Promise<RecentSite[]> {
    const stored = (await readJson<RecentSite[]>(recentSitesPath())) ?? []
    // Одноразовая миграция уже накопленных до этого фикса дублей одного
    // домена (список уже most-recent-first — первое вхождение ключа и есть
    // самая свежая запись, остальные для того же домена отбрасываем).
    const seen = new Set<string>()
    this.list = stored.filter((s) => {
      const key = siteKey(s.url)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (this.list.length !== stored.length) await this.persist()
    return this.list
  }

  getAll(): RecentSite[] {
    return this.list
  }

  /** Новая top-level навигация — стартовую страницу (data: URL) не запоминаем
   *  (см. isStartPage), реальный title/favicon подтянутся чуть позже отдельными
   *  событиями через updateLatestMeta. Дедуп по домену (см. siteKey), не по
   *  точному URL — переход на другую страницу того же домена ОБНОВЛЯЕТ
   *  существующую запись (новый url/время), а не создаёт вторую. */
  async recordVisit(url: string): Promise<void> {
    if (!url || isStartPage(url)) return
    const key = siteKey(url)
    this.list = this.list.filter((s) => siteKey(s.url) !== key)
    this.list.unshift({ url, title: '', faviconUrl: null, visitedAt: new Date().toISOString() })
    if (this.list.length > CAP) this.list.length = CAP
    await this.persist()
  }

  /** title/faviconUrl приходят от Electron ПОСЛЕ did-navigate (page-title-updated/
   *  page-favicon-updated) — уточняет уже записанную визитом запись, не создаёт
   *  новую и не двигает её порядок/visitedAt (это не новый визит). */
  async updateLatestMeta(url: string, meta: { title?: string; faviconUrl?: string | null }): Promise<void> {
    if (!url || isStartPage(url)) return
    const entry = this.list.find((s) => s.url === url)
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
    const before = this.list.length
    this.list = this.list.filter((s) => s.url !== url)
    if (this.list.length !== before) await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJson(recentSitesPath(), this.list)
    this.onUpdate?.(this.list)
  }
}
