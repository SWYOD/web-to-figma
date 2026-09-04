import { BrowserWindow, type WebContents } from 'electron'
import { convertElement, detectComponentCandidates, type DomSnapshotNode } from '@web-to-figma/conversion-engine'
import { createConsoleLogger } from '@web-to-figma/shared'
import type { DesignDocument } from '@web-to-figma/design-ast'
import type { ComponentScanResult, ScannedComponent } from '../shared/types'
import { buildSnapshotTree } from './domSnapshot'

const log = createConsoleLogger('componentScanner')
const CDP_PROTOCOL_VERSION = '1.3'
const MAX_COMPONENTS = 60
// Источник одновременно служит тайлом и полноэкранным просмотром. 240px из
// первой версии достаточно только для сетки и заметно мылится в lightbox.
const PREVIEW_DIMENSION = 1600
const OFFSCREEN_LOAD_TIMEOUT_MS = 15_000

interface EvaluateResult {
  result: { value?: { root: DomSnapshotNode | null; truncated: boolean } }
}

const SNAPSHOT_EXPRESSION = `(() => {
  const MAX = 1400
  const SKIP = new Set(['SCRIPT','STYLE','TEMPLATE','LINK','META','NOSCRIPT','HEAD'])
  const STYLE_KEYS = [
    'display','position','flex-direction','flex-wrap','justify-content','align-items','gap',
    'padding-top','padding-right','padding-bottom','padding-left',
    'border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius',
    'box-shadow','animation-name'
  ]
  let count = 0
  let truncated = false
  const path = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id)
    const parts = []
    let current = el
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (!parent) { parts.unshift(tag); break }
      const siblings = Array.from(parent.children)
      parts.unshift(tag + ':nth-child(' + (siblings.indexOf(current) + 1) + ')')
      current = parent
    }
    return parts.join(' > ')
  }
  const build = (el, parentRect) => {
    if (count >= MAX) { truncated = true; return null }
    if (SKIP.has(el.tagName)) return null
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return null
    count++
    const computedStyle = {}
    for (const key of STYLE_KEYS) computedStyle[key] = style.getPropertyValue(key)
    const elementChildren = el.tagName === 'SVG' ? [] : Array.from(el.children)
    const children = elementChildren.map((child) => build(child, rect)).filter(Boolean)
    const ownText = elementChildren.length === 0 ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
    const classValue = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: classValue.split(/\\s+/).filter(Boolean),
      computedStyle,
      box: { width: rect.width, height: rect.height, x: parentRect ? rect.x - parentRect.x : 0, y: parentRect ? rect.y - parentRect.y : 0 },
      pageBox: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
      sourceSelector: path(el),
      ...(ownText ? { text: ownText } : {}),
      ...(el.tagName === 'IMG' ? { asset: { assetId: '', kind: 'raster' } } : {}),
      ...(el.tagName === 'SVG' ? { asset: { assetId: '', kind: 'svg' } } : {}),
      ...(children.length ? { children } : {})
    }
  }
  return { root: build(document.body || document.documentElement, null), truncated }
})()`

export async function scanPageComponents(wc: WebContents): Promise<ComponentScanResult> {
  const dbg = wc.debugger
  // Видимая вкладка могла уже принадлежать picker/asset scanner. Автоскан не
  // должен piggyback-иться на чужую CDP-сессию и мешать интерактивной работе.
  if (dbg.isAttached()) return { components: [], truncated: false }
  dbg.attach(CDP_PROTOCOL_VERSION)
  try {
    await dbg.sendCommand('Runtime.enable')
    await dbg.sendCommand('Page.enable')
    const evaluated = (await dbg.sendCommand('Runtime.evaluate', {
      expression: SNAPSHOT_EXPRESSION,
      returnByValue: true
    })) as EvaluateResult
    const payload = evaluated.result.value
    if (!payload?.root) return { components: [], truncated: payload?.truncated ?? false }

    const allRecognized = detectComponentCandidates(payload.root)
    const recognized = allRecognized.slice(0, MAX_COMPONENTS)
    const components: ScannedComponent[] = recognized.map((candidate, index) => ({
      id: `component-${index + 1}`,
      selector: candidate.selector,
      name: candidate.name,
      tag: candidate.tag,
      classes: candidate.classes,
      instances: candidate.instances,
      width: candidate.width,
      height: candidate.height,
      confidence: candidate.confidence,
      ...(candidate.pageBox ? { pageBox: candidate.pageBox } : {})
    }))

    return { components, truncated: payload.truncated || allRecognized.length > MAX_COMPONENTS }
  } finally {
    if (dbg.isAttached()) dbg.detach()
  }
}

/** Снимает элемент из уже загруженного скрытого renderer. Элемент сначала
 * прокручивается в viewport, чтобы не использовать нестабильный
 * Page.captureScreenshot(captureBeyondViewport). `fullElement` (по запросу
 * пользователя, см. AppSettings.captureFullBlockThumbnail) — не обрезает
 * область по innerWidth/innerHeight; вызывающая сторона обязана заранее
 * убедиться, что offscreen-окно уже достаточно высокое (см.
 * captureElementPreviewOffscreen), иначе это ничего не даёт — здесь просто
 * снимается clip, реально помещающийся в текущий viewport окна. */
async function captureOffscreenElementBySelector(
  wc: WebContents,
  selector: string,
  padding = 20,
  fullElement = false
): Promise<string | null> {
  try {
    const clip = (await wc.executeJavaScript(
      `(async () => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        el.scrollIntoView({ block: ${fullElement ? "'start'" : "'center'"}, inline: 'center', behavior: 'instant' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const r = el.getBoundingClientRect()
        const p = ${padding}
        const x = Math.max(0, r.x - p)
        const y = Math.max(0, r.y - p)
        const right = ${fullElement} ? r.right + p : Math.min(innerWidth, r.right + p)
        const bottom = ${fullElement} ? r.bottom + p : Math.min(innerHeight, r.bottom + p)
        return { x, y, width: right - x, height: bottom - y }
      })()`,
      true
    )) as { x: number; y: number; width: number; height: number } | null
    if (!clip || clip.width <= 0 || clip.height <= 0) return null
    const image = await wc.capturePage({
      x: Math.floor(clip.x),
      y: Math.floor(clip.y),
      width: Math.max(1, Math.floor(clip.width)),
      height: Math.max(1, Math.floor(clip.height))
    })
    if (image.isEmpty()) return null
    const scale = Math.min(1, PREVIEW_DIMENSION / Math.max(clip.width, clip.height))
    const thumbnail =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(clip.width * scale)),
            height: Math.max(1, Math.round(clip.height * scale)),
            quality: 'good'
          })
        : image
    return `data:image/jpeg;base64,${thumbnail.toJPEG(82).toString('base64')}`
  } catch (err) {
    log.debug('offscreen element preview failed', { selector, message: (err as Error).message })
    return null
  }
}

/** Снимает один элемент в переданном скрытом webContents. */
export async function captureComponentPreview(wc: WebContents, selector: string, padding = 20): Promise<string | null> {
  return captureOffscreenElementBySelector(wc, selector, padding)
}

// Потолок для высоты офскрин-окна при fullElement-захвате (см.
// captureElementPreviewOffscreen ниже) — страховка от случайно выбранного
// блока размером во всю страницу (напр. <body>), который иначе заставил бы
// снимать и ресайзить окно на десятки тысяч пикселей.
const FULL_ELEMENT_MAX_HEIGHT = 8000

/**
 * Миниатюра произвольного выбранного элемента в отдельном невидимом renderer.
 * Важное отличие от wc.capturePage/Page.captureScreenshot на sourceWc:
 * compositor активной страницы вообще не участвует, поэтому нет моргания.
 *
 * `fullElement` (по запросу пользователя, см. AppSettings.captureFullBlockThumbnail
 * докстринг) — без него миниатюра длинного блока (выше окна встроенного
 * браузера) обрезалась по границе viewport'а, как будто "не полностью
 * захватывает". Т.к. окно тут всё равно офскрин/невидимое пользователю, его
 * можно спокойно РАСТЯНУТЬ по высоте под реальный размер элемента ПЕРЕД
 * финальным снимком — это не такой "живой дёрг", как временный override
 * viewport'а на видимой странице (см. inspector.ts withDesktopViewport
 * докстринг), тут смотреть некому. Ширину НЕ трогаем — не хотим менять
 * responsive-раскладку/переносы строк относительно того, что видел
 * пользователь, только даём вертикали больше места.
 */
export async function captureElementPreviewOffscreen(
  sourceWc: WebContents,
  sourceUrl: string,
  selector: string,
  viewport: { width: number; height: number },
  hint: { tag: string; id: string | null; classes: string[]; width: number; height: number },
  fullElement = false
): Promise<string | null> {
  if (!sourceUrl || !selector || sourceWc.isDestroyed()) return null
  const worker = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    useContentSize: true,
    width: Math.max(320, Math.round(viewport.width || 1280)),
    height: Math.max(240, Math.round(viewport.height || 720)),
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      session: sourceWc.session
    }
  })
  worker.webContents.setAudioMuted(true)
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      worker.loadURL(sourceUrl),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('offscreen queue preview load timeout')), OFFSCREEN_LOAD_TIMEOUT_MS)
      })
    ])
    await new Promise((resolve) => setTimeout(resolve, 250))
    // Абсолютный :nth-child selector может протухнуть между двумя загрузками
    // динамической страницы. Сначала проверяем его, затем ранжируем элементы
    // того же тега по id/classes/размерам и помечаем найденный временным attr.
    // Тяжёлые сайты (баннер cookie-согласия, ленивая отрисовка блоков — живой
    // баг на rostec.ru) не всегда успевают дать элементам реальный layout за
    // один цикл, из-за чего getBoundingClientRect() всех кандидатов
    // возвращает 0x0 и locate молча проваливается — несколько попыток с
    // растущей паузой (по жалобе пользователя "миниатюры не всегда
    // появляются" — одного повтора оказалось недостаточно на практике).
    const marker = `w2f-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const locateScript = (): string => `(() => {
        const expected = ${JSON.stringify(hint)}
        let direct = null
        try { direct = document.querySelector(${JSON.stringify(selector)}) } catch {}
        const candidates = Array.from(document.querySelectorAll(expected.tag))
        const score = (el) => {
          const rect = el.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return -Infinity
          const classes = new Set((typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')).split(/\\s+/).filter(Boolean))
          const overlap = expected.classes.filter((name) => classes.has(name)).length
          const widthRatio = Math.min(expected.width, rect.width) / Math.max(1, expected.width, rect.width)
          const heightRatio = Math.min(expected.height, rect.height) / Math.max(1, expected.height, rect.height)
          return (el === direct ? 100 : 0) + (expected.id && el.id === expected.id ? 80 : 0) + overlap * 12 + widthRatio * 6 + heightRatio * 6
        }
        let best = direct
        let bestScore = direct ? score(direct) : -Infinity
        for (const candidate of candidates) {
          const value = score(candidate)
          if (value > bestScore) { best = candidate; bestScore = value }
        }
        if (!best || bestScore < 7) return null
        best.setAttribute('data-w2f-queue-preview', ${JSON.stringify(marker)})
        return { selector: '[data-w2f-queue-preview="' + ${JSON.stringify(marker)} + '"]', score: bestScore }
      })()`
    let located: { selector: string; score: number } | null = null
    for (const waitMs of [0, 500, 1200, 2200]) {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
      located = (await worker.webContents.executeJavaScript(locateScript(), true)) as {
        selector: string
        score: number
      } | null
      if (located) break
    }
    if (!located) {
      log.warn('offscreen queue preview element not found', { sourceUrl, selector, tag: hint.tag, classes: hint.classes })
      return null
    }
    if (fullElement) {
      const naturalHeight = (await worker.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(located.selector)})?.getBoundingClientRect().height ?? 0`,
        true
      )) as number
      const neededHeight = Math.min(FULL_ELEMENT_MAX_HEIGHT, Math.ceil(naturalHeight + 40))
      const [contentWidth, contentHeight] = worker.getContentSize()
      const currentWidth = contentWidth ?? Math.round(viewport.width || 1280)
      const currentHeight = contentHeight ?? Math.round(viewport.height || 720)
      if (neededHeight > currentHeight) {
        worker.setContentSize(currentWidth, neededHeight)
        // Даём странице пересчитать layout под новую высоту viewport'а
        // (lazy-load/intersection observer у части сайтов реагируют на
        // размер viewport'а, не только на скролл) перед финальным снимком.
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }
    const thumbnail = await captureOffscreenElementBySelector(worker.webContents, located.selector, 20, fullElement)
    if (!thumbnail) {
      log.warn('offscreen queue preview capture is empty', { sourceUrl, selector, locatedScore: located.score })
      return null
    }
    log.debug('offscreen queue preview ready', { sourceUrl, selector, locatedScore: located.score })
    return thumbnail
  } catch (err) {
    log.debug('offscreen queue preview failed', { selector, message: (err as Error).message })
    return null
  } finally {
    if (timeout) clearTimeout(timeout)
    if (!worker.isDestroyed()) worker.destroy()
  }
}

/**
 * Загружает ту же страницу в полностью скрытом offscreen Chromium renderer и
 * последовательно снимает все найденные компоненты. Session общая с видимой
 * вкладкой (cookies/auth сохраняются), viewport тот же, но compositor другой —
 * поэтому ни автогенерация, ни fallback по клику не трогают активную страницу.
 */
export async function captureComponentPreviewsOffscreen(
  sourceWc: WebContents,
  sourceUrl: string,
  components: ScannedComponent[],
  viewport: { width: number; height: number },
  onPreview: (selector: string, thumbnail: string) => void,
  shouldContinue: () => boolean = () => true
): Promise<void> {
  if (!sourceUrl || components.length === 0 || !shouldContinue()) return
  const worker = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    useContentSize: true,
    width: Math.max(320, Math.round(viewport.width || 1280)),
    height: Math.max(240, Math.round(viewport.height || 720)),
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      session: sourceWc.session
    }
  })
  worker.webContents.setAudioMuted(true)
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      worker.loadURL(sourceUrl),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('offscreen preview load timeout')), OFFSCREEN_LOAD_TIMEOUT_MS)
      })
    ])
    if (!shouldContinue()) return

    // Даём late layout/font swaps завершить хотя бы два paint-такта. Это
    // происходит в невидимом renderer и никак не блокирует UI приложения.
    await new Promise((resolve) => setTimeout(resolve, 120))
    // Dynamic/React pages do not preserve absolute :nth-child selectors across
    // two loads (experiments, consent portals and async sections shift the
    // tree). Rescan the hidden copy and map semantic candidates instead of
    // blindly applying selectors captured in the visible tab.
    const workerComponents = (await scanPageComponents(worker.webContents)).components
    log.debug('offscreen component candidates', {
      source: components.map((component) => `${component.name}:${component.instances}:${component.width}x${component.height}`),
      worker: workerComponents.map((component) => `${component.name}:${component.instances}:${component.width}x${component.height}`)
    })
    const unused = new Set(workerComponents.map((_component, index) => index))
    const mapped = components.map((source) => {
      let bestIndex = -1
      let bestScore = -Infinity
      for (const index of unused) {
        const target = workerComponents[index]!
        if (source.tag !== target.tag) continue
        const sourceClasses = new Set(source.classes)
        const classOverlap = target.classes.filter((name) => sourceClasses.has(name)).length
        const widthRatio = Math.min(source.width, target.width) / Math.max(1, source.width, target.width)
        const heightRatio = Math.min(source.height, target.height) / Math.max(1, source.height, target.height)
        const score =
          2 +
          (source.name === target.name ? 8 : 0) +
          Math.min(5, classOverlap * 1.5) +
          widthRatio * 2 +
          heightRatio * 2 +
          (source.instances === target.instances ? 2 : 0)
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      if (bestIndex >= 0 && bestScore >= 7) {
        unused.delete(bestIndex)
        return { source, target: workerComponents[bestIndex]! }
      }
      // Static pages normally retain the exact selector. Keep it as a final
      // fallback when the hidden scan was truncated or found fewer groups.
      return { source, target: source }
    })

    for (const { source, target } of mapped) {
      if (!shouldContinue() || worker.isDestroyed()) break
      const thumbnail = await captureOffscreenElementBySelector(worker.webContents, target.selector, 20)
      if (thumbnail && shouldContinue()) onPreview(source.selector, thumbnail)
      else log.debug('offscreen component preview missing', { source: source.name, targetSelector: target.selector })
    }
  } catch (err) {
    log.debug('offscreen component previews failed', { sourceUrl, message: (err as Error).message })
  } finally {
    if (timeout) clearTimeout(timeout)
    if (!worker.isDestroyed()) worker.destroy()
  }
}

/** Повторно находит кандидата в живом DOM и только после явного действия
 * пользователя строит полноценный DesignDocument для создания Component. */
export async function captureComponentDocument(
  wc: WebContents,
  selector: string,
  sourceUrl: string,
  viewport: { width: number; height: number }
): Promise<DesignDocument | null> {
  const dbg = wc.debugger
  const alreadyAttached = dbg.isAttached()
  if (!alreadyAttached) dbg.attach(CDP_PROTOCOL_VERSION)
  try {
    await dbg.sendCommand('DOM.enable')
    await dbg.sendCommand('CSS.enable')
    await dbg.sendCommand('Runtime.enable')
    const evaluated = (await dbg.sendCommand('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false
    })) as { result: { objectId?: string; subtype?: string } }
    if (!evaluated.result.objectId || evaluated.result.subtype === 'null') return null
    const described = (await dbg.sendCommand('DOM.describeNode', {
      objectId: evaluated.result.objectId,
      depth: 0
    })) as { node: { backendNodeId: number } }
    const { tree, assets, truncated } = await buildSnapshotTree(wc, described.node.backendNodeId)
    const conversion = convertElement(tree)
    if (truncated) {
      conversion.diagnostics.push({
        nodeId: conversion.node.id,
        code: 'subtree-truncated',
        severity: 'warning',
        message: 'Поддерево слишком большое — часть вложенных элементов не импортирована.'
      })
    }
    return {
      version: 1,
      root: conversion.node,
      assets,
      diagnostics: conversion.diagnostics,
      metadata: { sourceUrl, capturedAt: new Date().toISOString(), viewport }
    }
  } finally {
    if (!alreadyAttached && dbg.isAttached()) dbg.detach()
  }
}
