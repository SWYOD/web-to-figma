import { useState } from 'react'
import { Check, RefreshCw, Send } from 'lucide-react'
import type { ScannedComponent, TabState } from '../../../shared/types'
import { AssetLightbox } from './AssetLightbox'
import type { TabComponentScan } from './BrowserPane'

type ActionState = 'sending' | 'sent' | 'error' | null

export function ComponentsPanel({
  tabs,
  scans
}: {
  tabs: TabState[]
  scans: Record<string, TabComponentScan>
}): JSX.Element {
  const [actions, setActions] = useState<Record<string, ActionState>>({})
  const [previewComponent, setPreviewComponent] = useState<ScannedComponent | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [loadingPreviewKey, setLoadingPreviewKey] = useState<string | null>(null)
  const groups = tabs.map((tab) => scans[tab.id]).filter((scan): scan is TabComponentScan => scan != null)

  const send = async (scan: TabComponentScan, component: ScannedComponent): Promise<void> => {
    const key = `${scan.tabId}:${component.selector}`
    setActions((state) => ({ ...state, [key]: 'sending' }))
    await window.api.browserSwitchTab(scan.tabId)
    const tabsSnapshot = await window.api.browserGetTabs()
    const sourceTab = tabsSnapshot.tabs.find((tab) => tab.id === scan.tabId)
    const result =
      sourceTab?.url === scan.pageUrl
        ? await window.api.componentsImport(component)
        : { ok: false, error: 'Страница изменилась — запустите скан повторно' }
    setActions((state) => ({ ...state, [key]: result.ok ? 'sent' : 'error' }))
    setTimeout(() => setActions((state) => ({ ...state, [key]: null })), result.ok ? 1200 : 2600)
  }

  const preview = async (scan: TabComponentScan, component: ScannedComponent): Promise<void> => {
    const key = `${scan.tabId}:${component.selector}`
    const cached = previews[key] ?? component.thumbnail
    if (cached) {
      setPreviewComponent({ ...component, thumbnail: cached })
      return
    }

    setLoadingPreviewKey(key)
    await window.api.browserSwitchTab(scan.tabId)
    const tabsSnapshot = await window.api.browserGetTabs()
    const sourceTab = tabsSnapshot.tabs.find((tab) => tab.id === scan.tabId)
    const result =
      sourceTab?.url === scan.pageUrl
        ? await window.api.componentsPreview(component)
        : { ok: false, error: 'Страница изменилась — запустите скан повторно' }
    setLoadingPreviewKey((current) => (current === key ? null : current))
    if (!result.ok || !result.thumbnail) return
    setPreviews((state) => ({ ...state, [key]: result.thumbnail! }))
    setPreviewComponent({ ...component, thumbnail: result.thumbnail })
  }

  return (
    <div className="components-panel">
      {groups.length === 0 && (
        <div className="placeholder-hint assets-empty">
          Запустите скан страницы. Здесь появятся повторяющиеся структуры, которые движок считает кандидатами в
          компоненты. Скан ничего не создаёт в Figma — создание происходит только по кнопке на карточке.
        </div>
      )}
      {groups.map((group) => (
        <div className="assets-page-group" key={group.tabId}>
          <div className="assets-page-group-title" title={group.tabTitle}>
            {group.tabTitle || 'Без названия'}
          </div>
          {group.components.length === 0 ? (
            <div className="placeholder-hint assets-empty">Надёжных кандидатов на этой странице не найдено.</div>
          ) : (
            <div className="components-grid">
              {group.components.map((component) => {
                const key = `${group.tabId}:${component.selector}`
                const action = actions[key] ?? null
                const thumbnail = previews[key] ?? component.thumbnail
                const previewLoading = loadingPreviewKey === key
                return (
                  <div className="component-card" key={key}>
                    <div
                      className="component-card-preview clickable"
                      title="Открыть полноэкранный просмотр"
                      onClick={() => void preview(group, component)}
                    >
                      {previewLoading ? (
                        <RefreshCw size={18} className="spin" />
                      ) : thumbnail ? (
                        <img src={thumbnail} alt="" />
                      ) : (
                        <span className="component-card-preview-loading" aria-label="Превью загружается" />
                      )}
                    </div>
                    <div className="component-card-info">
                      <div className="component-card-name" title={component.name}>{component.name}</div>
                      <div className="component-card-meta">
                        {component.instances} повт. · {component.width}×{component.height}
                      </div>
                    </div>
                    <button
                      className={`component-card-send${action === 'error' ? ' error' : ''}`}
                      title={action === 'error' ? 'Не удалось создать — проверьте Bridge или пересканируйте страницу' : 'Создать Component в Figma'}
                      disabled={action === 'sending'}
                      onClick={() => send(group, component)}
                    >
                      {action === 'sending' ? <RefreshCw size={13} className="spin" /> : action === 'sent' ? <Check size={13} /> : <Send size={13} />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {group.truncated && <div className="placeholder-hint assets-empty">Показана только наиболее уверенная часть кандидатов.</div>}
        </div>
      ))}
      {previewComponent?.thumbnail && (
        <AssetLightbox
          asset={{
            data: previewComponent.thumbnail,
            mimeType: 'image/jpeg',
            sourceUrl: `${previewComponent.name} · ${previewComponent.instances} повт. · ${previewComponent.width}×${previewComponent.height}`
          }}
          onClose={() => setPreviewComponent(null)}
        />
      )}
    </div>
  )
}
