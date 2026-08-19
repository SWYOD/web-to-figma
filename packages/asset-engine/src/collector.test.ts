import { describe, expect, it } from 'vitest'
import { AssetCollector } from './collector'

describe('AssetCollector', () => {
  it('fixture 7 (raster asset): registers a new raster asset with inline base64 transport', () => {
    const collector = new AssetCollector()
    const bytes = Buffer.from('fake-png-bytes')
    const asset = collector.addRaster({ kind: 'raster', mimeType: 'image/png', bytes, sourceUrl: 'https://x/img.png' })
    expect(asset.kind).toBe('raster')
    expect(asset.transport).toEqual({ mode: 'inline', data: bytes.toString('base64') })
    expect(collector.size).toBe(1)
  })

  it('fixture 8 (SVG asset): stores raw markup, not base64', () => {
    const collector = new AssetCollector()
    const asset = collector.addSvg({ svgMarkup: '<svg><path d="M0 0"/></svg>' })
    expect(asset.kind).toBe('svg')
    expect(asset.transport).toEqual({ mode: 'inline', data: '<svg><path d="M0 0"/></svg>' })
  })

  it('fixture 9 (duplicated icon): 20 identical raster references collapse to one asset', () => {
    const collector = new AssetCollector()
    const bytes = Buffer.from('icon-bytes')
    for (let i = 0; i < 20; i++) {
      collector.addRaster({ kind: 'icon', mimeType: 'image/png', bytes, sourceUrl: `https://x/icon.png?v=${i}` })
    }
    expect(collector.size).toBe(1)
  })

  it('fixture 9 for SVG: identical markup with different whitespace/formatting still dedupes', () => {
    const collector = new AssetCollector()
    const a = collector.addSvg({ svgMarkup: '<svg><path d="M0 0"/></svg>' })
    const b = collector.addSvg({ svgMarkup: '<svg>\n  <path   d="M0 0"/>\n</svg>' })
    expect(a.id).toBe(b.id)
    expect(collector.size).toBe(1)
  })

  it('different content produces different assets', () => {
    const collector = new AssetCollector()
    collector.addRaster({ kind: 'raster', mimeType: 'image/png', bytes: Buffer.from('a') })
    collector.addRaster({ kind: 'raster', mimeType: 'image/png', bytes: Buffer.from('b') })
    expect(collector.size).toBe(2)
  })

  it('manifest keys match asset ids', () => {
    const collector = new AssetCollector()
    const asset = collector.addRaster({ kind: 'raster', mimeType: 'image/png', bytes: Buffer.from('x') })
    expect(collector.manifest()[asset.id]).toEqual(asset)
  })

  it('routes assets over the 256KB inline threshold to ref transport (docs/asset-model.md)', () => {
    const collector = new AssetCollector()
    const big = Buffer.alloc(300 * 1024, 1)
    const asset = collector.addRaster({ kind: 'raster', mimeType: 'image/png', bytes: big })
    expect(asset.transport.mode).toBe('ref')
  })
})
