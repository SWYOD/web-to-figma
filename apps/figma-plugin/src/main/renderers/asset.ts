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
