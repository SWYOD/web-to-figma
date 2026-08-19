import { contextBridge, ipcRenderer } from 'electron'
import type {
  Api,
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  BridgeStatusEvent,
  ColorMatchSource,
  ImportResult,
  OverlayOpenPayload,
  OverlaySize,
  PickState,
  RecentSite,
  SelectionResult,
  TabsSnapshot,
  ViewBounds
} from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
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

  browserNewTab: () => ipcRenderer.invoke('browser:new-tab'),
  browserCloseTab: (id: string) => ipcRenderer.invoke('browser:close-tab', id),
  browserSwitchTab: (id: string) => ipcRenderer.invoke('browser:switch-tab', id),
  browserGetTabs: () => ipcRenderer.invoke('browser:get-tabs'),
  onTabsState: (cb: (snapshot: TabsSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: TabsSnapshot): void => cb(snapshot)
    ipcRenderer.on('browser:tabs', listener)
    return () => ipcRenderer.removeListener('browser:tabs', listener)
  },

  overlayOpen: (payload: OverlayOpenPayload) => ipcRenderer.invoke('overlay:open', payload),
  overlayClose: () => ipcRenderer.invoke('overlay:close'),
  overlayReportSize: (size: OverlaySize) => ipcRenderer.invoke('overlay:report-size', size),
  onOverlayContent: (cb: (kind: string | null) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, kind: string | null): void => cb(kind)
    ipcRenderer.on('overlay:content', listener)
    return () => ipcRenderer.removeListener('overlay:content', listener)
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
  inspectorImportAsFrame: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<ImportResult> =>
    ipcRenderer.invoke('inspector:import-as-frame', useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),
  inspectorApplyStyles: (targets: ApplyStylesTargets): Promise<ApplyStylesResult> =>
    ipcRenderer.invoke('inspector:apply-styles', targets),

  recentSitesGet: () => ipcRenderer.invoke('recent-sites:get'),
  recentSitesRemove: (url: string) => ipcRenderer.invoke('recent-sites:remove', url),
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, list: RecentSite[]): void => cb(list)
    ipcRenderer.on('recent-sites:updated', listener)
    return () => ipcRenderer.removeListener('recent-sites:updated', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
