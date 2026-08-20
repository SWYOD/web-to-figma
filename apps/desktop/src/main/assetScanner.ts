import type { WebContents } from 'electron'
import sharp from 'sharp'
import { createConsoleLogger } from '@web-to-figma/shared'
import { fetchAssetBytes, hashContent } from '@web-to-figma/asset-engine'
import type { ScannedAsset, AssetScanResult } from '../shared/types'

const log = createConsoleLogger('assetScanner')

// Debugger.attach() принимает конкретную версию протокола — та же, что
// ElementPicker (inspector.ts) — фиксируем, а не оставляем "latest".
const CDP_PROTOCOL_VERSION = '1.3'

const ELEMENT_NODE = 1
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])
/** figma.createImage() принимает только эти форматы — та же граница, что в domSnapshot.ts. */
const SUPPORTED_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif'])
/** Защита от сотен ассетов на тяжёлых SPA-страницах — просто листинг для
 *  панели, не полноценный импорт, поэтому лимит проще MAX_NODES в domSnapshot.ts. */
const MAX_ASSETS = 300
/** Отдельная страница-галерея живёт целиком в памяти desktop-рендерера —
 *  без 256KB-лимита bridge-транспорта (см. AssetCollector), но всё равно не
 *  безлимитно: гигантский hero-баннер не должен раздувать IPC-сообщение. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024
/** Превью-тайл в сетке — 72px, с запасом под retina (см. AssetsPanel.tsx). */
const MAX_THUMBNAIL_DIMENSION = 160

interface CdpNode {
  backendNodeId: number
  nodeType: number
  nodeName: string
  attributes?: string[]
  children?: CdpNode[]
}
interface GetDocumentResult {
  root: CdpNode & { baseURL: string }
}
interface BoxModelResult {
  model: { width: number; height: number }
}
interface OuterHtmlResult {
  outerHTML: string
}
interface PushNodesResult {
  nodeIds: number[]
}
interface ComputedStyleResult {
  computedStyle: { name: string; value: string }[]
}

function getAttr(node: CdpNode, name: string): string | undefined {
  const attrs = node.attributes ?? []
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1]
  }
  return undefined
}

/**
 * Сканирует ВСЮ страницу (не поддерево одного выбранного элемента, как
 * `domSnapshot.ts`'s `buildSnapshotTree`) на `<img>`/inline `<svg>` — для
 * панели ассетов (по запросу пользователя: отдельный обзор иконок/картинок
 * сайта, не привязан к текущему выбору через Inspector). Не собирает
 * layout/computed-style — не нужны для простого листинга, только байты +
 * размеры, поэтому заметно дешевле полного `buildSnapshotTree`.
 *
 * Классификация "иконка vs картинка" — по формату: SVG почти всегда иконка/
 * логотип на реальных сайтах, растр — почти всегда фото/иллюстрация. Не
 * идеально (бывают SVG-иллюстрации и PNG-иконки), но простой и предсказуемый
 * дефолт без эвристики по размеру, которая на реальных сайтах ловит больше
 * ложных срабатываний, чем эта.
 */
export async function scanPageAssets(wc: WebContents): Promise<AssetScanResult> {
  const dbg = wc.debugger
  // Как ElementPicker.prepareForImport() (inspector.ts) — пикер уже
  // отсоединяет debugger сразу после каждого клика, поэтому к моменту вызова
  // сканера сессии обычно нет, подключаем сами и отсоединяем в finally. Если
  // сессия УЖЕ была (пикер в процессе работы) — переиспользуем, не рвём чужую.
  const alreadyAttached = dbg.isAttached()
  if (!alreadyAttached) dbg.attach(CDP_PROTOCOL_VERSION)
  try {
    return await scanWithAttachedDebugger(dbg)
  } finally {
    if (!alreadyAttached && dbg.isAttached()) dbg.detach()
  }
}

async function scanWithAttachedDebugger(dbg: WebContents['debugger']): Promise<AssetScanResult> {
  // CSS.getComputedStyleForNode (нужен для currentColor ниже) молча не
  // работает, пока домен не включён явно — тот же шаг, что ElementPicker
  // делает перед пиком (inspector.ts) — DOM.getDocument/getOuterHTML/
  // getBoxModel так не требовательны, поэтому это легко упустить, когда
  // пишешь новую CDP-функцию с нуля и проверяешь только их.
  await dbg.sendCommand('DOM.enable')
  await dbg.sendCommand('CSS.enable')
  const doc = (await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: false })) as GetDocumentResult
  const baseURL = doc.root.baseURL

  const svgNodes: CdpNode[] = []
  const imgNodes: CdpNode[] = []
  let truncated = false

  const collect = (node: CdpNode): void => {
    if (svgNodes.length + imgNodes.length >= MAX_ASSETS) {
      truncated = true
      return
    }
    const tag = node.nodeName.toUpperCase()
    if (tag === 'SVG') {
      svgNodes.push(node)
      return // не спускаемся во внутренний DOM svg — один vector-ассет, не поддерево
    }
    if (tag === 'IMG') imgNodes.push(node)

    for (const child of node.children ?? []) {
      if (child.nodeType !== ELEMENT_NODE || SKIP_TAGS.has(child.nodeName)) continue
      collect(child)
    }
  }
  collect(doc.root)

  const byHash = new Map<string, ScannedAsset>()
  let nextId = 1

  const addSvg = (rawMarkup: string, sourceUrl: string | undefined, width: number | undefined, height: number | undefined, resolvedColor?: string): void => {
    const markup = prepareSvgMarkup(rawMarkup, resolvedColor)
    const normalized = markup.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
    const hash = hashContent(normalized)
    if (byHash.has(hash)) return
    const data = `data:image/svg+xml;base64,${Buffer.from(markup, 'utf-8').toString('base64')}`
    byHash.set(hash, { id: `asset-${nextId++}`, kind: 'icon', mimeType: 'image/svg+xml', width, height, sourceUrl, data })
  }

  /**
   * Два независимых исправления markup инлайновых `<svg>` перед тем, как
   * завернуть их в `data:` URL — оба нужны, иначе превью тихо не
   * рендерится (naturalWidth=0, complete=true, никакой ошибки в консоли):
   *
   * 1. `DOM.getOuterHTML` не сериализует `xmlns` на `<svg>` внутри HTML-
   *    документа — там namespace выводится неявно по правилам HTML5-парсера.
   *    Отдельный `data:image/svg+xml` документ так не умеет — без явного
   *    `xmlns="http://www.w3.org/2000/svg"` Chromium не может декодировать
   *    его как картинку. Добавляем всегда, если markup его не содержит.
   * 2. `fill="currentColor"`/`stroke="currentColor"` (обычная практика
   *    иконочных наборов) вне страницы не наследует цвет со страницы —
   *    подставляем РЕАЛЬНЫЙ вычисленный цвет исходного узла явным
   *    `style="color:…"`, а не угадываем константу, чтобы превью и итоговая
   *    нода в Figma совпадали с тем, что видно на сайте.
   */
  function prepareSvgMarkup(markup: string, resolvedColor: string | undefined): string {
    const openTagMatch = markup.match(/^<svg\b[^>]*>/)
    if (!openTagMatch) return markup
    let openTag = openTagMatch[0]
    if (!/\bxmlns=/.test(openTag)) {
      openTag = openTag.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    if (resolvedColor && markup.includes('currentColor')) {
      openTag = openTag.includes('style="')
        ? openTag.replace('style="', `style="color:${resolvedColor};`)
        : openTag.replace(/^<svg\b/, `<svg style="color:${resolvedColor}"`)
    }
    return openTag + markup.slice(openTagMatch[0].length)
  }

  // Миниатюра генерируется ЗДЕСЬ, в main-процессе, через sharp (libvips) —
  // не в рендерере через `new Image()` + canvas (было раньше, см. живой баг:
  // жалоба пользователя на многосекундное подвисание панели при накоплении
  // десятков/сотен ассетов). Декод+ресайз полноразмерного фото в рендерере
  // блокирует UI-поток синхронно на каждый тайл; sharp делает то же в Node,
  // не трогая UI вообще, и заметно быстрее (C++/libvips против canvas).
  const addRaster = async (
    bytes: Buffer,
    mimeType: string,
    sourceUrl: string,
    width: number | undefined,
    height: number | undefined
  ): Promise<void> => {
    if (bytes.length > MAX_ASSET_BYTES) return
    const hash = hashContent(bytes)
    if (byHash.has(hash)) return
    let thumbnail: string | undefined
    try {
      const resized = sharp(bytes).resize(MAX_THUMBNAIL_DIMENSION, MAX_THUMBNAIL_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      const thumbBytes = await resized.jpeg({ quality: 82 }).toBuffer()
      thumbnail = `data:image/jpeg;base64,${thumbBytes.toString('base64')}`
    } catch (err) {
      log.debug('failed to generate thumbnail', { sourceUrl, message: (err as Error).message })
    }
    byHash.set(hash, {
      id: `asset-${nextId++}`,
      kind: 'image',
      mimeType,
      width,
      height,
      sourceUrl,
      data: `data:${mimeType};base64,${bytes.toString('base64')}`,
      thumbnail
    })
  }

  const svgNodeIds =
    svgNodes.length > 0
      ? ((await dbg.sendCommand('DOM.pushNodesByBackendIdsToFrontend', {
          backendNodeIds: svgNodes.map((n) => n.backendNodeId)
        })) as PushNodesResult)
      : { nodeIds: [] }
  const nodeIdByBackendId = new Map(svgNodes.map((n, i) => [n.backendNodeId, svgNodeIds.nodeIds[i]]))

  await Promise.all([
    ...svgNodes.map(async (node) => {
      try {
        const nodeId = nodeIdByBackendId.get(node.backendNodeId)
        const [outer, box, computed] = await Promise.all([
          dbg.sendCommand('DOM.getOuterHTML', { backendNodeId: node.backendNodeId }) as Promise<OuterHtmlResult>,
          (dbg.sendCommand('DOM.getBoxModel', { backendNodeId: node.backendNodeId }).catch(() => null)) as Promise<BoxModelResult | null>,
          nodeId === undefined
            ? Promise.resolve(null)
            : ((dbg.sendCommand('CSS.getComputedStyleForNode', { nodeId }).catch(() => null)) as Promise<ComputedStyleResult | null>)
        ])
        // Чисто служебные SVG (напр. <defs>/<filter> для CSS filter: url(#x),
        // без видимого содержимого) рендерятся с нулевым box — не настоящая
        // иконка, не добавляем в список (иначе панель забивают пустые тайлы).
        if (box && box.model.width === 0 && box.model.height === 0) return
        const color = computed?.computedStyle.find((e) => e.name === 'color')?.value
        addSvg(outer.outerHTML, undefined, box?.model.width, box?.model.height, color)
      } catch (err) {
        log.debug('failed to capture inline svg', { message: (err as Error).message })
      }
    }),
    ...imgNodes.map(async (node) => {
      const src = getAttr(node, 'src')
      if (!src) return
      try {
        const absoluteUrl = new URL(src, baseURL).href
        const fetched = await fetchAssetBytes(absoluteUrl)
        if (!fetched) return
        const box = (await dbg.sendCommand('DOM.getBoxModel', { backendNodeId: node.backendNodeId }).catch(() => null)) as BoxModelResult | null

        // <img src="x.svg"> — SVG, загруженный как обычная картинка, не inline.
        if (fetched.mimeType === 'image/svg+xml') {
          addSvg(fetched.bytes.toString('utf-8'), absoluteUrl, box?.model.width, box?.model.height)
          return
        }
        if (!SUPPORTED_RASTER_MIME.has(fetched.mimeType)) return
        await addRaster(fetched.bytes, fetched.mimeType, absoluteUrl, box?.model.width, box?.model.height)
      } catch (err) {
        log.debug('failed to fetch img asset', { src, message: (err as Error).message })
      }
    })
  ])

  return { assets: [...byHash.values()], truncated }
}
