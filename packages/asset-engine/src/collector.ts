import type { AssetKind, DesignAsset } from '@web-to-figma/design-ast'
import { hashContent } from './hash.js'

export interface AddRasterInput {
  kind: Extract<AssetKind, 'raster' | 'icon'>
  sourceUrl?: string
  mimeType: string
  bytes: Buffer
  width?: number
  height?: number
}

export interface AddSvgInput {
  sourceUrl?: string
  svgMarkup: string
  width?: number
  height?: number
}

/** Ассеты крупнее этого инлайнятся не полностью — см. docs/asset-model.md §Транспорт. */
const INLINE_LIMIT_BYTES = 256 * 1024

/**
 * Хэш-дедупликация ассетов внутри одного DesignDocument (fixture 9: 20
 * одинаковых SVG-иконок → одна запись). Не трогает сеть — байты уже должны
 * быть получены вызывающей стороной (см. `fetchAsset.ts`), это только
 * бухгалтерия хэш → DesignAsset. Чистая логика, тестируется без сети.
 */
export class AssetCollector {
  private readonly byHash = new Map<string, DesignAsset>()

  addRaster(input: AddRasterInput): DesignAsset {
    const hash = hashContent(input.bytes)
    const existing = this.byHash.get(hash)
    if (existing) return existing

    const asset: DesignAsset = {
      id: `asset-${this.byHash.size + 1}`,
      kind: input.kind,
      mimeType: input.mimeType,
      hash,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      transport:
        input.bytes.length <= INLINE_LIMIT_BYTES
          ? { mode: 'inline', data: input.bytes.toString('base64') }
          : // Phase 9 MVP: помечаем как ref, но доставка по требованию (GetAssetBytes)
            // ещё не реализована — см. docs/asset-model.md. Крупные ассеты сейчас
            // просто не долетят до Figma; это осознанное ограничение среза, не баг.
            { mode: 'ref', token: hash }
    }
    this.byHash.set(hash, asset)
    return asset
  }

  addSvg(input: AddSvgInput): DesignAsset {
    // Нормализация пробелов — чтобы два одинаковых по смыслу SVG с разным
    // форматированием не считались разными ассетами (см. asset-model.md).
    // Сначала убираем пробелы МЕЖДУ тегами (">  <" → "><"), иначе перенос
    // строки между тегами схлопывается в пробел вместо исчезновения.
    const normalized = input.svgMarkup
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim()
    const hash = hashContent(normalized)
    const existing = this.byHash.get(hash)
    if (existing) return existing

    const asset: DesignAsset = {
      id: `asset-${this.byHash.size + 1}`,
      kind: 'svg',
      mimeType: 'image/svg+xml',
      hash,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      transport: { mode: 'inline', data: input.svgMarkup }
    }
    this.byHash.set(hash, asset)
    return asset
  }

  get size(): number {
    return this.byHash.size
  }

  manifest(): Record<string, DesignAsset> {
    const out: Record<string, DesignAsset> = {}
    for (const asset of this.byHash.values()) out[asset.id] = asset
    return out
  }
}
