import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeSyncMessage } from '@web-to-figma/bridge-protocol'
import type {
  Api,
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  AssetScanResult,
  ComponentScanResult,
  ComponentPreviewResult,
  ComponentPreviewReadyEvent,
  BridgeStatusEvent,
  ColorMatchSource,
  ImportResult,
  ImportProgressEvent,
  OverlaySize,
  PickState,
  QueueImportResult,
  QueueItemSummary,
  RecentSite,
  ScannedAsset,
  ScannedComponent,
  SelectionResult,
  TabsSnapshot,
  UpdateReadyInfo,
  UpdateStatus,
  ViewBounds
} from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  syncPluginTheme: (theme: ThemeSyncMessage['payload']) => ipcRenderer.invoke('theme:sync-plugin', theme),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getBridgeInfo: () => ipcRenderer.invoke('bridge:get-info'),
  onBridgeStatus: (cb: (status: BridgeStatusEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: BridgeStatusEvent): void => cb(status)
    ipcRenderer.on('bridge:status', listener)
    return () => ipcRenderer.removeListener('bridge:status', listener)
  },

  browserNavigate: (input: string) => ipcRenderer.invoke('browser:navigate', input),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserStop: () => ipcRenderer.invoke('browser:stop'),
  browserSetBounds: (bounds: ViewBounds) => ipcRenderer.invoke('browser:set-bounds', bounds),
  browserSetHidden: (hidden: boolean) => ipcRenderer.invoke('browser:set-hidden', hidden),
  overlaySetSuppressed: (suppressed: boolean) => ipcRenderer.invoke('overlay:set-suppressed', suppressed),

  browserNewTab: (url?: string) => ipcRenderer.invoke('browser:new-tab', url),
  browserCloseTab: (id: string) => ipcRenderer.invoke('browser:close-tab', id),
  browserSwitchTab: (id: string) => ipcRenderer.invoke('browser:switch-tab', id),
  browserGetTabs: () => ipcRenderer.invoke('browser:get-tabs'),
  onTabsState: (cb: (snapshot: TabsSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: TabsSnapshot): void => cb(snapshot)
    ipcRenderer.on('browser:tabs', listener)
    return () => ipcRenderer.removeListener('browser:tabs', listener)
  },

  overlayReportSize: (size: OverlaySize) => ipcRenderer.invoke('overlay:report-size', size),
  onOverlayCollapsePopover: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('overlay:collapse-popover', listener)
    return () => ipcRenderer.removeListener('overlay:collapse-popover', listener)
  },

  inspectorStartPick: () => ipcRenderer.invoke('inspector:start-pick'),
  inspectorStopPick: () => ipcRenderer.invoke('inspector:stop-pick'),
  onInspectorPickState: (cb: (state: PickState) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: PickState): void => cb(state)
    ipcRenderer.on('inspector:pick-state', listener)
    return () => ipcRenderer.removeListener('inspector:pick-state', listener)
  },
  onInspectorSelection: (cb: (result: SelectionResult) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, result: SelectionResult): void => cb(result)
    ipcRenderer.on('inspector:selection', listener)
    return () => ipcRenderer.removeListener('inspector:selection', listener)
  },
  inspectorGetLastSelection: (): Promise<SelectionResult | null> => ipcRenderer.invoke('inspector:get-last-selection'),
  inspectorClearSelection: (): Promise<void> => ipcRenderer.invoke('inspector:clear-selection'),
  onInspectorSelectionCleared: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('inspector:selection-cleared', listener)
    return () => ipcRenderer.removeListener('inspector:selection-cleared', listener)
  },
  inspectorImportAsFrame: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<ImportResult> =>
    ipcRenderer.invoke('inspector:import-as-frame', useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),
  inspectorImportAsComponent: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource,
    alsoCreateInstance: boolean
  ): Promise<ImportResult> =>
    ipcRenderer.invoke(
      'inspector:import-as-component',
      useMatchedTextStyles,
      useMatchedColorStyles,
      colorMatchSource,
      alsoCreateInstance
    ),
  inspectorApplyStyles: (targets: ApplyStylesTargets): Promise<ApplyStylesResult> =>
    ipcRenderer.invoke('inspector:apply-styles', targets),

  inspectorSetQueueMode: (active: boolean) => ipcRenderer.invoke('inspector:set-queue-mode', active),
  onInspectorQueuePending: (cb: (item: QueueItemSummary) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, item: QueueItemSummary): void => cb(item)
    ipcRenderer.on('inspector:queue-pending', listener)
    return () => ipcRenderer.removeListener('inspector:queue-pending', listener)
  },
  onInspectorQueueUpdated: (cb: (items: QueueItemSummary[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, items: QueueItemSummary[]): void => cb(items)
    ipcRenderer.on('inspector:queue-updated', listener)
    return () => ipcRenderer.removeListener('inspector:queue-updated', listener)
  },
  inspectorQueueGet: (): Promise<QueueItemSummary[]> => ipcRenderer.invoke('inspector:queue-get'),
  inspectorQueueConfirmAdd: () => ipcRenderer.invoke('inspector:queue-confirm-add'),
  inspectorQueueConfirmCancel: () => ipcRenderer.invoke('inspector:queue-confirm-cancel'),
  inspectorQueueRemove: (id: string) => ipcRenderer.invoke('inspector:queue-remove', id),
  inspectorQueueClear: () => ipcRenderer.invoke('inspector:queue-clear'),
  inspectorQueueLocate: (id: string): Promise<ImportResult> => ipcRenderer.invoke('inspector:queue-locate', id),
  inspectorImportQueue: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<QueueImportResult> =>
    ipcRenderer.invoke('inspector:import-queue', useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),

  assetsScan: (): Promise<AssetScanResult> => ipcRenderer.invoke('assets:scan'),
  assetsCopy: (asset: ScannedAsset): Promise<ImportResult> => ipcRenderer.invoke('assets:copy', asset),
  assetsSendToFigma: (asset: ScannedAsset): Promise<ImportResult> => ipcRenderer.invoke('assets:send-to-figma', asset),
  componentsScan: (): Promise<ComponentScanResult> => ipcRenderer.invoke('components:scan'),
  componentsPreview: (component: ScannedComponent): Promise<ComponentPreviewResult> =>
    ipcRenderer.invoke('components:preview', component),
  onComponentPreviewReady: (cb: (event: ComponentPreviewReadyEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ComponentPreviewReadyEvent): void => cb(event)
    ipcRenderer.on('components:preview-ready', listener)
    return () => ipcRenderer.removeListener('components:preview-ready', listener)
  },

  onImportProgress: (cb: (event: ImportProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ImportProgressEvent): void => cb(event)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
  componentsImport: (component: ScannedComponent): Promise<ImportResult> => ipcRenderer.invoke('components:import', component),

  recentSitesGet: () => ipcRenderer.invoke('recent-sites:get'),
  recentSitesRemove: (url: string) => ipcRenderer.invoke('recent-sites:remove', url),
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, list: RecentSite[]): void => cb(list)
    ipcRenderer.on('recent-sites:updated', listener)
    return () => ipcRenderer.removeListener('recent-sites:updated', listener)
  },

  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
  onUpdateReady: (cb: (info: UpdateReadyInfo) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: UpdateReadyInfo): void => cb(info)
    ipcRenderer.on('updater:ready', listener)
    return () => ipcRenderer.removeListener('updater:ready', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
