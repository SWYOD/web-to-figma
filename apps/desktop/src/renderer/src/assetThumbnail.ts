const MAX_THUMBNAIL_DIMENSION = 160

/**
 * Уменьшенная копия растрового `data:` URL для превью в сетке ассетов —
 * сканер (main/assetScanner.ts) намеренно отдаёт растр БЕЗ уменьшения (до
 * 8MB, чтобы "Отправить в Figma"/"Скопировать" получали оригинал), но
 * рендерить эти же байты напрямую в 72px-тайле дорого: браузер декодирует
 * ПОЛНОРАЗМЕРНОЕ изображение ради миниатюры, и с десятками/сотнями
 * накопленных ассетов (см. docs/architecture.md — аккумуляция по страницам)
 * именно это декодирование подвешивает панель (жалоба пользователя).
 * `asset.data` (оригинал) не трогаем — только генерируем ОТДЕЛЬНУЮ
 * уменьшенную копию для превью.
 */
export function makeThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = MAX_THUMBNAIL_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight)
      // Не апскейлим — если оригинал уже меньше порога, миниатюра не нужна.
      if (!Number.isFinite(scale) || scale >= 1) {
        resolve(dataUrl)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // JPEG, не PNG — превью не нуждается в прозрачности ценой размера, а
      // разница в качестве на 72px-тайле не видна.
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}
