/// <reference types="@figma/plugin-typings" />
import type { AssetManifest } from '@web-to-figma/design-ast'

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Ref-транспорт (крупные ассеты, docs/asset-model.md) — доставка по требованию
 *  ещё не реализована в этом срезе, поэтому такие ассеты просто пропускаются. */
export function createImagePaint(assetId: string, assets: AssetManifest): Paint | null {
  const asset = assets[assetId]
  if (!asset || (asset.kind !== 'raster' && asset.kind !== 'icon') || asset.transport.mode !== 'inline') return null
  const image = figma.createImage(base64ToUint8Array(asset.transport.data))
  return { type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }
}

export function createVectorFromAsset(assetId: string, assets: AssetManifest): FrameNode | null {
  const asset = assets[assetId]
  if (!asset || asset.kind !== 'svg' || asset.transport.mode !== 'inline') return null
  try {
    return figma.createNodeFromSvg(asset.transport.data)
  } catch {
    return null
  }
}

export interface PlaceAssetPayload {
  assetKind: 'icon' | 'image'
  mimeType: string
  width?: number
  height?: number
  /** `data:<mime>;base64,<...>` — см. ScannedAsset.data в desktop/shared/types.ts. */
  data: string
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) throw new Error('Invalid data URL')
  return base64ToUint8Array(dataUrl.slice(commaIndex + 1))
}

/** Песочница Figma-плагина не даёт `TextDecoder` (это не браузерная страница,
 *  а урезанная JS-среда) — декодируем UTF-8 вручную по байтам. */
function utf8Decode(bytes: Uint8Array): string {
  let result = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      result += String.fromCharCode(b0)
      i += 1
    } else if (b0 >> 5 === 0x6) {
      const b1 = bytes[i + 1]!
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
      i += 2
    } else if (b0 >> 4 === 0xe) {
      const b1 = bytes[i + 1]!
      const b2 = bytes[i + 2]!
      result += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
      i += 3
    } else {
      const b1 = bytes[i + 1]!
      const b2 = bytes[i + 2]!
      const b3 = bytes[i + 3]!
      let codepoint = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      codepoint -= 0x10000
      result += String.fromCharCode(0xd800 + (codepoint >> 10), 0xdc00 + (codepoint & 0x3ff))
      i += 4
    }
  }
  return result
}

/**
 * Панель ассетов (см. main/assetScanner.ts) — "отправить в Figma" ОДИН
 * конкретный ассет вне полноценного дерева импорта. Payload самодостаточен
 * (`data:` URL прямо в сообщении), не ссылка в `AssetManifest`, поэтому
 * отдельная функция, а не переиспользование `createImagePaint`/
 * `createVectorFromAsset` выше (те читают из манифеста DesignDocument).
 */
export function createAssetNode(payload: PlaceAssetPayload): SceneNode {
  if (payload.mimeType === 'image/svg+xml') {
    const svgMarkup = utf8Decode(decodeDataUrl(payload.data))
    const vector = figma.createNodeFromSvg(svgMarkup)
    // НЕ vector.resize(w, h) напрямую — та тянет ширину/высоту независимо
    // друг от друга, а захваченный box (getBoxModel контейнера на странице,
    // см. assetScanner.ts) может быть другой пропорции, чем родной viewBox
    // SVG (напр. иконка вписана в квадратный контейнер через
    // preserveAspectRatio/object-fit — на странице не искажалась, а тут
    // растягивалась бы в квадрат). rescale() масштабирует ОДНИМ коэффициентом,
    // сохраняя пропорции, «впритык» по меньшей из осей — как object-fit:contain.
    if (payload.width && payload.height && vector.width > 0 && vector.height > 0) {
      const scale = Math.min(payload.width / vector.width, payload.height / vector.height)
      if (Number.isFinite(scale) && scale > 0) vector.rescale(scale)
    }
    return vector
  }

  const image = figma.createImage(decodeDataUrl(payload.data))
  const rect = figma.createRectangle()
  rect.name = 'Image'
  rect.resize(Math.max(1, payload.width ?? 100), Math.max(1, payload.height ?? 100))
  rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }]
  return rect
}
