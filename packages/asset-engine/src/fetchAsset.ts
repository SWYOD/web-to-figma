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
/** Живой баг, поймал пользователь: "Импортировать страницу целиком" теряло
 *  картинки (не одну и ту же каждый раз — проверено прямым fetch() с тем же
 *  UA: один и тот же URL то отвечает 200 мгновенно, то держит TCP-соединение
 *  до таймаута, СЛУЧАЙНО от попытки к попытке — тот же WAF-тарпит, что и
 *  комментарий у USER_AGENT выше уже описывает как "снижает вероятность, не
 *  гарантия"). Один элемент импортирует 1-2 картинки — шанс словить тарпит
 *  на КОНКРЕТНОЙ из них небольшой; вся страница разом — десятки картинок
 *  через ASSET_CONCURRENCY, и вероятность хотя бы одного случайного
 *  таймаута за импорт растёт кратно. Одна лишняя попытка при неудаче — не
 *  панацея (тарпит может повториться и на ней), но заметно снижает
 *  накопленную вероятность потери конкретной картинки за один импорт. */
const FETCH_RETRY_ATTEMPTS = 2
const ASSET_CACHE_TTL_MS = 5 * 60_000
const FAILED_ASSET_CACHE_TTL_MS = 30_000
const ASSET_CACHE_MAX_ENTRIES = 256

export interface FetchedAsset {
  bytes: Buffer
  mimeType: string
}

interface CachedAsset {
  value: FetchedAsset
  expiresAt: number
}

/** Повторные элементы одной страницы часто ссылаются на те же логотипы,
 * иконки и фотографии. Кэшируем только успешные ответы, а Promise держим
 * отдельно, чтобы параллельные снапшоты не скачивали один URL несколько раз. */
const assetCache = new Map<string, CachedAsset>()
const failedAssetCache = new Map<string, number>()
const inFlightAssets = new Map<string, Promise<FetchedAsset | null>>()

function rememberAsset(url: string, value: FetchedAsset): void {
  failedAssetCache.delete(url)
  assetCache.delete(url)
  assetCache.set(url, { value, expiresAt: Date.now() + ASSET_CACHE_TTL_MS })
  while (assetCache.size > ASSET_CACHE_MAX_ENTRIES) {
    const oldest = assetCache.keys().next().value as string | undefined
    if (!oldest) break
    assetCache.delete(oldest)
  }
}

function rememberFailedAsset(url: string): void {
  failedAssetCache.delete(url)
  failedAssetCache.set(url, Date.now() + FAILED_ASSET_CACHE_TTL_MS)
  while (failedAssetCache.size > ASSET_CACHE_MAX_ENTRIES) {
    const oldest = failedAssetCache.keys().next().value as string | undefined
    if (!oldest) break
    failedAssetCache.delete(oldest)
  }
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
  const cached = assetCache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    // Buffer не мутируется downstream, но отдельная ссылка защищает кэш от
    // случайной мутации будущим потребителем.
    return { bytes: Buffer.from(cached.value.bytes), mimeType: cached.value.mimeType }
  }
  if (cached) assetCache.delete(url)
  const failedUntil = failedAssetCache.get(url)
  if (failedUntil && failedUntil > Date.now()) return null
  if (failedUntil) failedAssetCache.delete(url)

  const pending = inFlightAssets.get(url)
  if (pending) return pending

  const request = fetchAssetBytesUncached(url).finally(() => inFlightAssets.delete(url))
  inFlightAssets.set(url, request)
  return request
}

async function fetchAssetBytesUncached(url: string): Promise<FetchedAsset | null> {
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) {
        if (attempt < FETCH_RETRY_ATTEMPTS) continue
        rememberFailedAsset(url)
        return null
      }
      const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
      const bytes = Buffer.from(await res.arrayBuffer())

      if (CONVERT_TO_PNG_MIME.has(mimeType)) {
        try {
          const png = await sharp(bytes).png().toBuffer()
          const value = { bytes: png, mimeType: 'image/png' }
          rememberAsset(url, value)
          return value
        } catch {
          // Битый/нераспознанный файл — падаем обратно на исходные байты,
          // downstream-фильтр (SUPPORTED_RASTER_MIME) их и так отбросит как
          // недиагностируемую ошибку, а не молча притворится, что всё ок.
        }
      }

      const value = { bytes, mimeType }
      rememberAsset(url, value)
      return value
    } catch {
      if (attempt < FETCH_RETRY_ATTEMPTS) continue
      rememberFailedAsset(url)
      return null
    }
  }
  return null
}
