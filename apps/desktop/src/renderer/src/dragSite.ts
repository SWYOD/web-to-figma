import type { DragEvent } from 'react'

/** Общий формат drag-payload для перетаскивания сайта в проект/между
 *  проектами в сайдбаре (по запросу пользователя), см. LeftSidebar.tsx/
 *  ProjectSection.tsx. Свой MIME-тип, а не text/plain — иначе случайно
 *  подхватил бы drag откуда угодно ещё (напр. текст, выделенный в браузере). */
export const SITE_DRAG_MIME = 'application/x-w2f-site'

export interface DraggedSite {
  url: string
  title: string
  faviconUrl: string | null
  /** Проект-источник, если сайт перетаскивают ИЗ другого проекта, а не из
   *  несортированного списка — определяет addSite vs moveSiteToProject
   *  на стороне обработчика drop. */
  fromProjectId?: string
  /** Источник — референс-сайт БЕЗ проекта (см. shared/types.ts
   *  StandaloneReferenceSite, ReferencesSidebar.tsx) — drop-обработчик тогда
   *  должен звать standaloneReferencesAttachToProject (переносит и уже
   *  собранные ReferenceItem), а не обычный projectsAddSite, который просто
   *  скопировал бы запись, оставив дубликат висеть в standalone-сторе. */
  fromStandalone?: boolean
}

export function packDragSite(e: DragEvent, site: DraggedSite): void {
  e.dataTransfer.setData(SITE_DRAG_MIME, JSON.stringify(site))
  e.dataTransfer.effectAllowed = 'move'
}

export function unpackDragSite(e: DragEvent): DraggedSite | null {
  const raw = e.dataTransfer.getData(SITE_DRAG_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DraggedSite
  } catch {
    return null
  }
}
