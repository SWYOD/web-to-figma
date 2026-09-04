import { app } from 'electron'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { nanoid } from 'nanoid'
import type { ReferenceItem } from '../shared/types'

/** `projectId: null` — референс без проекта (по запросу пользователя), см.
 *  shared/types.ts StandaloneReferenceSite/main/standaloneReferenceSites.ts. */
export function referenceSiteKey(projectId: string | null, url: string): string {
  return `${projectId ?? 'none'}::${url}`
}

function referenceItemsPath(): string {
  return join(app.getPath('userData'), 'reference-items.json')
}

// Тот же readJson/writeJson паттерн, что и в recentSites.ts/projects.ts —
// продублирован намеренно (см. recentSites.ts докстринг про small focused
// modules), не импортирован оттуда.
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

export type CreateReferenceItemInput = Omit<ReferenceItem, 'id' | 'createdAt' | 'sentToFigmaAt'>

/**
 * Референс-элементы, собранные пикером с конкретных референс-сайтов (по
 * запросу пользователя — референс теперь не просто закладка на весь сайт, а
 * галерея выбранных элементов с него), см. shared/types.ts ReferenceItem
 * докстринг про `siteKey`. Отдельный JSON-файл, а не вложение в
 * projects.json — тот перезаписывается целиком на каждую правку проекта
 * (ProjectsStore.persist()), тащить туда base64-миниатюры элементов было бы
 * лишней нагрузкой на каждую несвязанную правку. Коммитится СРАЗУ по
 * "Добавить" (не транзитно, как обычная очередь пикера) — это и есть
 * постоянная галерея, которую страница референс-сайта показывает при
 * повторном заходе, независимо от того, активна ли сейчас сессия сбора.
 */
export class ReferenceItemsStore {
  private items: ReferenceItem[] = []

  constructor(private readonly onUpdate?: (items: ReferenceItem[]) => void) {}

  async load(): Promise<ReferenceItem[]> {
    this.items = (await readJson<ReferenceItem[]>(referenceItemsPath())) ?? []
    return this.items
  }

  getForSite(siteKey: string): ReferenceItem[] {
    return this.items.filter((i) => i.siteKey === siteKey)
  }

  findById(id: string): ReferenceItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  async create(input: CreateReferenceItemInput): Promise<ReferenceItem> {
    const item: ReferenceItem = { ...input, id: nanoid(), createdAt: new Date().toISOString() }
    this.items.push(item)
    await this.persist(item.siteKey)
    return item
  }

  async updateMeta(id: string, patch: { name?: string; description?: string }): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    if (patch.name !== undefined) item.name = patch.name
    if (patch.description !== undefined) item.description = patch.description
    await this.persist(item.siteKey)
  }

  /** Патчит миниатюру уже сохранённого элемента — офскрин-снимок (см.
   *  inspector.ts scheduleQueueThumbnail) почти всегда завершается ПОСЛЕ
   *  того, как index.ts успевает закоммитить элемент сюда (пользователь
   *  жмёт "Добавить" быстрее, чем офскрин-вкладка успевает загрузить
   *  страницу и снять кадр) — без этого метода тот кадр просто некуда
   *  записать задним числом, и карточка навсегда остаётся без превью (живой
   *  баг, поймал пользователь). См. main/index.ts onItemThumbnailReady. */
  async updateThumbnail(id: string, thumbnail: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.thumbnail = thumbnail
    await this.persist(item.siteKey)
  }

  async markSent(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.sentToFigmaAt = new Date().toISOString()
    await this.persist(item.siteKey)
  }

  async remove(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    this.items = this.items.filter((i) => i.id !== id)
    await this.persist(item.siteKey)
  }

  /** Чистка при удалении/переносе референс-сайта из проекта (см.
   *  main/index.ts projectsRemoveSite/projectsMoveSiteToProject) — иначе
   *  элементы осиротевшего siteKey остаются в файле мёртвым грузом. */
  async removeForSite(siteKey: string): Promise<void> {
    const before = this.items.length
    this.items = this.items.filter((i) => i.siteKey !== siteKey)
    if (this.items.length !== before) await this.persist(siteKey)
  }

  private async persist(siteKey: string): Promise<void> {
    await writeJson(referenceItemsPath(), this.items)
    this.onUpdate?.(this.getForSite(siteKey))
  }
}
