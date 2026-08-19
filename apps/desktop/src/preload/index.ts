import { contextBridge, ipcRenderer } from 'electron'
import type {
  Api,
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  BridgeStatusEvent,
  BrowserState,
  ImportResult,
  PickState,
  RecentSite,
  SelectionResult,
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
  browserGetState: () => ipcRenderer.invoke('browser:get-state'),
  onBrowserState: (cb: (state: BrowserState) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: BrowserState): void => cb(state)
    ipcRenderer.on('browser:state', listener)
    return () => ipcRenderer.removeListener('browser:state', listener)
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
  inspectorImportAsFrame: (useMatchedStyles: boolean): Promise<ImportResult> =>
    ipcRenderer.invoke('inspector:import-as-frame', useMatchedStyles),
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
