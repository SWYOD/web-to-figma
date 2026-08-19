// Реалистичный UA — некоторые CDN отдают 4xx на дефолтный Node/Electron UA
// (проверено live на upload.wikimedia.org). Не помогает всем (см.
// docs/architecture.md §риски) — это снижает вероятность блокировки, не гарантия.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 web-to-figma'

export interface FetchedAsset {
  bytes: Buffer
  mimeType: string
}

/**
 * Скачивает asset напрямую из main-процесса Electron — НЕ через JS-инъекцию
 * в контексте страницы (что упёрлось бы в её CSP) и НЕ через CDP
 * `Page.getResourceContent` (эмпирически ненадёжен для уже загруженных
 * суб-ресурсов — см. docs/architecture.md §риски, проверено live перед
 * реализацией). Обычный fetch из Node-контекста CORS не подвержен вообще.
 * Ошибка — просто `null`, вызывающая сторона решает (diagnostic, не крах).
 */
export async function fetchAssetBytes(url: string): Promise<FetchedAsset | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    const bytes = Buffer.from(await res.arrayBuffer())
    return { bytes, mimeType }
  } catch {
    return null
  }
}
