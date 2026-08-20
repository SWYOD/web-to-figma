import { memo, useCallback, useState } from 'react'
import { Check, Copy, Image as ImageIcon, RefreshCw, Send } from 'lucide-react'
import type { ScannedAsset, TabState } from '../../../shared/types'
import { AssetLightbox } from './AssetLightbox'
import type { PageAssetBatch, TabAssetScan } from './BrowserPane'

/** Транзитное состояние одной кнопки (copy/send) на одном тайле — ключ
 *  составной (`tabId:data`), не `tabId:assetId`: `ScannedAsset.id` нумеруется
 *  заново в КАЖДОМ скане, а после аккумуляции по нескольким страницам одной
 *  вкладки (см. BrowserPane.scanActiveTab) в одной группе могут оказаться
 *  ассеты из разных сканов с одинаковым `id` — `data` (сам `data:` URL)
 *  гарантированно уникален в пределах вкладки, т.к. по нему же идёт дедуп. */
type ActionState = 'copy' | 'copied' | 'send' | 'sent' | 'send-error' | null

interface Props {
  tabs: TabState[]
  scans: Record<string, TabAssetScan>
}

/**
 * Ассеты нижней панели (см. main/assetScanner.ts) — кнопка скана теперь в
 * шапке `BottomPanel` (иконка, по запросу пользователя), здесь только сама
 * галерея. Результат сканирования по каждой вкладке живёт в `BrowserPane`
 * (не здесь) — переключение вкладок этой панели/сворачивание не должно
 * стирать уже отсканированное, см. docs/architecture.md. Несколько
 * отсканированных вкладок браузера показываются отдельными группами с
 * заголовком страницы, в порядке вкладок браузера.
 */
export function AssetsPanel({ tabs, scans }: Props): JSX.Element {
  const [actions, setActions] = useState<Record<string, ActionState>>({})
  const [previewAsset, setPreviewAsset] = useState<ScannedAsset | null>(null)
  // useCallback — стабильная идентичность нужна `AssetTile`'s memo() ниже,
  // иначе он бы получал "новый" onCopy/onSend на каждый рендер AssetsPanel
  // (который сам перерисовывается при каждом клике copy/send через actions)
  // и сравнение по ссылке в memo никогда бы не совпадало — с сотнями
  // накопленных тайлов (см. BrowserPane.MAX_TOTAL_ASSETS_PER_DOMAIN) это и
  // была реальная причина подтормаживания при жалобе пользователя.
  const setAction = useCallback((key: string, action: ActionState): void => setActions((s) => ({ ...s, [key]: action })), [])

  const copy = useCallback(
    async (asset: ScannedAsset, key: string): Promise<void> => {
      setAction(key, 'copy')
      await window.api.assetsCopy(asset)
      setAction(key, 'copied')
      setTimeout(() => setAction(key, null), 1200)
    },
    [setAction]
  )

  const send = useCallback(
    async (asset: ScannedAsset, key: string): Promise<void> => {
      setAction(key, 'send')
      const result = await window.api.assetsSendToFigma(asset)
      setAction(key, result.ok ? 'sent' : 'send-error')
      setTimeout(() => setAction(key, null), result.ok ? 1200 : 2500)
    },
    [setAction]
  )

  const groups = tabs.map((t) => scans[t.id]).filter((g): g is TabAssetScan => g != null)

  return (
    <div className="assets-panel">
      {groups.length === 0 && (
        <div className="placeholder-hint assets-empty">
          Нажмите на иконку скана в шапке панели — найдёт иконки (SVG) и картинки на текущей странице, отдельно
          скопировать в буфер или сразу отправить в Figma. При переключении вкладок браузера можно отсканировать
          каждую — результаты по всем вкладкам останутся здесь одновременно. Повторный скан после перехода на
          другую страницу той же вкладки добавляет новые ассеты к уже найденным, а не заменяет их.
        </div>
      )}

      {groups.map((group) => (
        <AssetGroup key={group.tabId} group={group} actions={actions} onCopy={copy} onSend={send} onPreview={setPreviewAsset} />
      ))}

      {previewAsset && <AssetLightbox asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
    </div>
  )
}

function AssetGroup({
  group,
  actions,
  onCopy,
  onSend,
  onPreview
}: {
  group: TabAssetScan
  actions: Record<string, ActionState>
  onCopy: (asset: ScannedAsset, key: string) => void
  onSend: (asset: ScannedAsset, key: string) => void
  onPreview: (asset: ScannedAsset) => void
}): JSX.Element {
  // Подпись "с какой страницы" на партии показываем только если страниц
  // реально несколько — на самой обычной странице (одна вкладка, один скан)
  // это была бы просто дублирующая подпись заголовка группы.
  const showPageCaptions = group.batches.length > 1
  const isEmpty = group.batches.every((b) => b.assets.length === 0)

  return (
    <div className="assets-page-group">
      <div className="assets-page-group-title" title={group.tabTitle}>
        {group.tabTitle || 'Без названия'}
      </div>

      {isEmpty && (
        <div className="placeholder-hint assets-empty">На странице не нашлось иконок/картинок, подходящих для импорта.</div>
      )}

      {group.batches.map((batch) => (
        <PageBatch
          key={batch.pageUrl}
          tabId={group.tabId}
          batch={batch}
          showCaption={showPageCaptions}
          actions={actions}
          onCopy={onCopy}
          onSend={onSend}
          onPreview={onPreview}
        />
      ))}

      {group.truncated && (
        <div className="placeholder-hint assets-empty">Показаны не все — на странице их больше, чем поместилось за один скан.</div>
      )}
    </div>
  )
}

function PageBatch({
  tabId,
  batch,
  showCaption,
  actions,
  onCopy,
  onSend,
  onPreview
}: {
  tabId: string
  batch: PageAssetBatch
  showCaption: boolean
  actions: Record<string, ActionState>
  onCopy: (asset: ScannedAsset, key: string) => void
  onSend: (asset: ScannedAsset, key: string) => void
  onPreview: (asset: ScannedAsset) => void
}): JSX.Element {
  const icons = batch.assets.filter((a) => a.kind === 'icon')
  const images = batch.assets.filter((a) => a.kind === 'image')
  if (icons.length === 0 && images.length === 0) return <></>

  return (
    <div className="assets-page-batch">
      {showCaption && (
        <div className="assets-page-batch-caption" title={batch.pageUrl}>
          {batch.pageTitle || batch.pageUrl}
        </div>
      )}

      {icons.length > 0 && (
        <div className="assets-section">
          <div className="assets-section-title">Иконки · {icons.length}</div>
          <div className="assets-grid assets-grid-icons">
            {icons.map((asset) => {
              const key = `${tabId}:${asset.data}`
              return (
                <AssetTile key={key} asset={asset} actionKey={key} action={actions[key] ?? null} onCopy={onCopy} onSend={onSend} onPreview={onPreview} />
              )
            })}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="assets-section">
          <div className="assets-section-title">Картинки · {images.length}</div>
          <div className="assets-grid assets-grid-images">
            {images.map((asset) => {
              const key = `${tabId}:${asset.data}`
              return (
                <AssetTile key={key} asset={asset} actionKey={key} action={actions[key] ?? null} onCopy={onCopy} onSend={onSend} onPreview={onPreview} />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// memo — сравнивает пропсы по ссылке (asset/onCopy/onSend/onPreview все
// стабильны между рендерами, action меняется только у ЗАТРОНУТОГО тайла) —
// без него клик copy/send на ОДНОМ тайле перерисовывал бы КАЖДЫЙ тайл во
// всех группах/партиях; с сотнями накопленных ассетов (см. BrowserPane —
// MAX_TOTAL_ASSETS_PER_DOMAIN) это и была заметная часть подтормаживания.
const AssetTile = memo(function AssetTile({
  asset,
  actionKey,
  action,
  onCopy,
  onSend,
  onPreview
}: {
  asset: ScannedAsset
  actionKey: string
  action: ActionState
  onCopy: (asset: ScannedAsset, key: string) => void
  onSend: (asset: ScannedAsset, key: string) => void
  onPreview: (asset: ScannedAsset) => void
}): JSX.Element {
  return (
    <div className="asset-tile" title={asset.sourceUrl ?? asset.mimeType} onClick={() => onPreview(asset)}>
      {asset.data ? (
        <img className="asset-tile-thumb" src={asset.thumbnail ?? asset.data} alt="" decoding="async" loading="lazy" />
      ) : (
        <ImageIcon size={16} className="asset-tile-fallback" />
      )}
      <div className="asset-tile-actions">
        <span
          className="asset-tile-action"
          title="Скопировать"
          onClick={(e) => {
            e.stopPropagation()
            onCopy(asset, actionKey)
          }}
        >
          {action === 'copy' ? <RefreshCw size={12} className="spin" /> : action === 'copied' ? <Check size={12} /> : <Copy size={12} />}
        </span>
        <span
          className={`asset-tile-action${action === 'send-error' ? ' error' : ''}`}
          title={action === 'send-error' ? 'Не удалось отправить — плагин подключён?' : 'Отправить в Figma'}
          onClick={(e) => {
            e.stopPropagation()
            onSend(asset, actionKey)
          }}
        >
          {action === 'send' ? <RefreshCw size={12} className="spin" /> : action === 'sent' ? <Check size={12} /> : <Send size={12} />}
        </span>
      </div>
    </div>
  )
})
