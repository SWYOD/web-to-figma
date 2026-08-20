import sharp from 'sharp'

// Реалистичный UA — некоторые CDN отдают 4xx на дефолтный Node/Electron UA
// (проверено live на upload.wikimedia.org). БЕЗ опознавательного суффикса —
// живой баг, пойманный пользователем (фото сотрудников с ris.pxls-cdn.ru не
// импортировались): суффикс " web-to-figma" на конце строки — ровно то, по
// чему WAF/CDN может отличить незнакомого бота от браузера и не отдать 4xx
// как честную ошибку, а тихо продержать TCP-соединение до Connect Timeout
// (проверено live: с суффиксом — `Connect Timeout Error` через 10с, без
// суффикса — мгновенный 200). Не помогает всем (см. docs/architecture.md
// §риски) — это снижает вероятность блокировки, не гарантия.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** figma.createImage() принимает только PNG/JPEG/GIF — форматы отсюда молча
 *  проваливают downstream mime-фильтр (см. domSnapshot.ts/assetScanner.ts
 *  SUPPORTED_RASTER_MIME) и выпадают из импорта, даже когда сам fetch прошёл
 *  успешно. Живой баг: фото сотрудников на ris.pxls-cdn.ru лежат в .webp —
 *  UA-фикс чинил только сетевой запрос, картинки всё равно пропадали здесь.
 *  Конвертация через `sharp` (libvips, N-API — без пересборки под Electron
 *  ABI), НЕ через `electron.nativeImage`: тот на практике не умеет
 *  декодировать WebP (`createFromBuffer().isEmpty() === true` на реальных
 *  файлах с ris.pxls-cdn.ru, известное ограничение Electron), проверено live. */
const CONVERT_TO_PNG_MIME = new Set(['image/webp', 'image/avif', 'image/bmp', 'image/tiff'])

/** Живой баг: клик пикером иногда "подвисал" на заметное время перед тем,
 *  как элемент реально выбирался — capture блокируется на fetch ВСЕХ
 *  картинок в поддереве (см. domSnapshot.ts), а без таймаута один медленный/
 *  зависший CDN (тот же класс проблемы, что и UA-тарпит выше — сервер держит
 *  соединение открытым, не отдавая ни ответ, ни честную ошибку) стопорил
 *  выбор НАСОВСЕМ, а не на разумное время. 8с — достаточно для честного
 *  медленного фото, но не бесконечность; таймаут — просто ещё один failure-
 *  путь (см. `return null`), картинка выпадает из снапшота, остальные не
 *  ждут её. */
const FETCH_TIMEOUT_MS = 8000

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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    const bytes = Buffer.from(await res.arrayBuffer())

    if (CONVERT_TO_PNG_MIME.has(mimeType)) {
      try {
        const png = await sharp(bytes).png().toBuffer()
        return { bytes: png, mimeType: 'image/png' }
      } catch {
        // Битый/нераспознанный файл — падаем обратно на исходные байты,
        // downstream-фильтр (SUPPORTED_RASTER_MIME) их и так отбросит как
        // недиагностируемую ошибку, а не молча притворится, что всё ок.
      }
    }

    return { bytes, mimeType }
  } catch {
    return null
  }
}
