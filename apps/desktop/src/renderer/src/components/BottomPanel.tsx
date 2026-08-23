import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import { clamp, IconButton } from '@web-to-figma/ui'
import type { TabState } from '../../../shared/types'
import { AssetsPanel } from './AssetsPanel'
import { ComponentsPanel } from './ComponentsPanel'
import type { TabAssetScan, TabComponentScan } from './BrowserPane'

const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 140
// Сколько минимум оставить видимому браузеру снизу центральной колонки —
// табы+тулбар уже съедают своё сверху, эта константа не даёт body панели
// вытеснить вьюпорт до полностью неудобного состояния (кроме maximized —
// там пользователь явно просит браузер спрятать целиком).
const MIN_BROWSER_RESERVE = 160
const HEADER_HEIGHT = 37

const PANEL_TABS = [
  { value: 'assets', label: 'Ассеты' },
  { value: 'components', label: 'Компоненты' }
] as const
type PanelTab = (typeof PANEL_TABS)[number]['value']

interface Props {
  tabs: TabState[]
  scans: Record<string, TabAssetScan>
  componentScans: Record<string, TabComponentScan>
  scanningTabId: string | null
  onScan: () => void
  maximized: boolean
  onMaximizedChange: (maximized: boolean) => void
}

/**
 * Нижняя закреплённая панель центральной рабочей области (по запросу
 * пользователя — раньше жила вкладкой в левом сайдбаре, там при переключении
 * вкладок сайдбара размонтировалась и теряла состояние скана, см.
 * docs/architecture.md). Состояние скана теперь живёт выше, в `BrowserPane`
 * (не размонтируется вместе с переключением вкладок ЭТОЙ панели) — здесь
 * только высота/collapsed/maximized и текущая внутренняя вкладка.
 */
export function BottomPanel({ tabs, scans, componentScans, scanningTabId, onScan, maximized, onMaximizedChange }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(true)
  const [bodyHeight, setBodyHeight] = useState(DEFAULT_HEIGHT)
  const [panelTab, setPanelTab] = useState<PanelTab>('assets')
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ lastY: number; maxHeight: number } | null>(null)
  const isScanning = scanningTabId !== null

  const openTab = (tab: PanelTab): void => {
    setPanelTab(tab)
    setCollapsed(false)
  }

  // Клик по всей полосе заголовка в свёрнутом состоянии — разворачивает (по
  // запросу пользователя, узкая иконка-шеврон была неудобной мишенью). В
  // развёрнутом состоянии сворачивает только явная кнопка-шеврон — иначе
  // случайный клик по заголовку при работе с вкладками/сканом сворачивал бы
  // панель неожиданно.
  const onHeaderClick = (): void => {
    if (collapsed) setCollapsed(false)
  }
  const stopAnd =
    (fn: () => void) =>
    (e: ReactMouseEvent): void => {
      e.stopPropagation()
      fn()
    }

  const onResizerPointerDown = (e: ReactPointerEvent): void => {
    const containerHeight = panelRef.current?.parentElement?.getBoundingClientRect().height ?? 0
    dragRef.current = { lastY: e.clientY, maxHeight: Math.max(MIN_HEIGHT, containerHeight - MIN_BROWSER_RESERVE) }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onResizerPointerMove = (e: ReactPointerEvent): void => {
    if (!dragRef.current) return
    const dy = dragRef.current.lastY - e.clientY
    dragRef.current.lastY = e.clientY
    setBodyHeight((h) => clamp(h + dy, MIN_HEIGHT, dragRef.current!.maxHeight))
  }
  const onResizerPointerUp = (): void => {
    dragRef.current = null
  }

  return (
    <div ref={panelRef} className={`bottom-panel${maximized ? ' maximized' : ''}`}>
      {!collapsed && !maximized && (
        <div
          className="bottom-panel-resizer"
          onPointerDown={onResizerPointerDown}
          onPointerMove={onResizerPointerMove}
          onPointerUp={onResizerPointerUp}
        />
      )}
      <div
        className={`bottom-panel-header${collapsed ? ' collapsed' : ''}`}
        style={{ height: HEADER_HEIGHT }}
        onClick={onHeaderClick}
      >
        <div className="bottom-panel-tabs">
          {PANEL_TABS.map((t) => (
            <button
              key={t.value}
              className={`bottom-panel-tab${!collapsed && panelTab === t.value ? ' active' : ''}`}
              onClick={stopAnd(() => openTab(t.value))}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="bottom-panel-header-actions">
          <IconButton size="xs" title="Сканировать текущую страницу" onClick={stopAnd(onScan)} disabled={isScanning}>
            <RefreshCw size={13} className={isScanning ? 'spin' : ''} />
          </IconButton>
          {!collapsed && (
            <IconButton
              size="xs"
              title={maximized ? 'Вернуть размер' : 'На всю рабочую область'}
              onClick={stopAnd(() => onMaximizedChange(!maximized))}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </IconButton>
          )}
          <IconButton
            size="xs"
            title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
            onClick={stopAnd(() => {
              if (!collapsed) onMaximizedChange(false)
              setCollapsed((v) => !v)
            })}
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </IconButton>
        </div>
      </div>
      {!collapsed && (
        <div className="bottom-panel-body" style={maximized ? { flex: '1 1 auto' } : { flex: '0 0 auto', height: bodyHeight }}>
          {panelTab === 'assets' && <AssetsPanel tabs={tabs} scans={scans} />}
          {panelTab === 'components' && <ComponentsPanel tabs={tabs} scans={componentScans} />}
        </div>
      )}
    </div>
  )
}
