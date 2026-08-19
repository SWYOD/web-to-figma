import { createHash } from 'node:crypto'

/** Ключ дедупликации — контент, не URL (см. docs/asset-model.md §Дедупликация). */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
