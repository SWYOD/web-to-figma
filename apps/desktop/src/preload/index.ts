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
  PopoverOpenParams,
  CreateProjectInput,
  Project,
  ProjectsSnapshot,
  QueueImportResult,
  QueueItemSummary,
  RecentSite,
  ReferenceItem,
  ReferenceSessionState,
  ScannedAsset,
  ScannedComponent,
  SelectionResult,
  StandaloneReferenceSite,
  TabsSnapshot,
  UpdateReadyInfo,
  UpdateStatus,
  ViewBounds
} from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  syncPluginTheme: (theme: ThemeSyncMessage['payload']) => ipcRenderer.invoke('theme:sync-plugin', theme),
  onExternalThemeSync: (cb: (theme: ThemeSyncMessage['payload']) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: ThemeSyncMessage['payload']): void => cb(theme)
    ipcRenderer.on('theme:external-sync', listener)
    return () => ipcRenderer.removeListener('theme:external-sync', listener)
  },
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  searchSuggest: (query: string): Promise<string[]> => ipcRenderer.invoke('search:suggest', query),
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

  referenceBrowserNavigate: (input: string) => ipcRenderer.invoke('reference-browser:navigate', input),
  referenceBrowserBack: () => ipcRenderer.invoke('reference-browser:back'),
  referenceBrowserForward: () => ipcRenderer.invoke('reference-browser:forward'),
  referenceBrowserReload: () => ipcRenderer.invoke('reference-browser:reload'),
  referenceBrowserStop: () => ipcRenderer.invoke('reference-browser:stop'),
  referenceBrowserSetBounds: (bounds: ViewBounds) => ipcRenderer.invoke('reference-browser:set-bounds', bounds),
  referenceBrowserSetHidden: (hidden: boolean) => ipcRenderer.invoke('reference-browser:set-hidden', hidden),
  referenceBrowserNewTab: (url?: string) => ipcRenderer.invoke('reference-browser:new-tab', url),
  referenceBrowserCloseTab: (id: string) => ipcRenderer.invoke('reference-browser:close-tab', id),
  referenceBrowserSwitchTab: (id: string) => ipcRenderer.invoke('reference-browser:switch-tab', id),
  referenceBrowserGetTabs: () => ipcRenderer.invoke('reference-browser:get-tabs'),
  onReferenceBrowserTabs: (cb: (snapshot: TabsSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: TabsSnapshot): void => cb(snapshot)
    ipcRenderer.on('reference-browser:tabs', listener)
    return () => ipcRenderer.removeListener('reference-browser:tabs', listener)
  },

  overlayReportSize: (size: OverlaySize) => ipcRenderer.invoke('overlay:report-size', size),
  onOverlayCollapsePopover: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('overlay:collapse-popover', listener)
    return () => ipcRenderer.removeListener('overlay:collapse-popover', listener)
  },

  overlayOpenPopover: (params: PopoverOpenParams) => ipcRenderer.invoke('overlay:popover-open', params),
  overlayClosePopover: () => ipcRenderer.invoke('overlay:popover-close'),
  overlayPopoverReportSize: (size: OverlaySize) => ipcRenderer.invoke('overlay:popover-report-size', size),
  onPopoverClosed: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('overlay:popover-closed', listener)
    return () => ipcRenderer.removeListener('overlay:popover-closed', listener)
  },
  onPopoverShow: (cb: (payload: { kind: string; props: unknown }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { kind: string; props: unknown }): void => cb(payload)
    ipcRenderer.on('popover:show', listener)
    return () => ipcRenderer.removeListener('popover:show', listener)
  },
  popoverAction: (action: { type: string; payload?: unknown }) => ipcRenderer.invoke('overlay:popover-action', action),
  onPopoverAction: (cb: (action: { type: string; payload?: unknown }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, action: { type: string; payload?: unknown }): void => cb(action)
    ipcRenderer.on('overlay:popover-action', listener)
    return () => ipcRenderer.removeListener('overlay:popover-action', listener)
  },

  overlayPanelHover: (params: { side: 'left' | 'right' | 'top' | 'references-left' | 'references-right'; entering: boolean }) =>
    ipcRenderer.invoke('overlay:panel-hover', params),

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
  inspectorSelectTreeNode: (sourceSelector: string): Promise<boolean> =>
    ipcRenderer.invoke('inspector:select-tree-node', sourceSelector),
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
  inspectorImportFullPage: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<ImportResult> =>
    ipcRenderer.invoke('inspector:import-full-page', useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),
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
  importCancel: (id: string): Promise<void> => ipcRenderer.invoke('import:cancel', id),
  componentsImport: (component: ScannedComponent): Promise<ImportResult> => ipcRenderer.invoke('components:import', component),

  recentSitesGet: () => ipcRenderer.invoke('recent-sites:get'),
  recentSitesRemove: (url: string) => ipcRenderer.invoke('recent-sites:remove', url),
  recentSitesTogglePin: (url: string) => ipcRenderer.invoke('recent-sites:toggle-pin', url),
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, list: RecentSite[]): void => cb(list)
    ipcRenderer.on('recent-sites:updated', listener)
    return () => ipcRenderer.removeListener('recent-sites:updated', listener)
  },

  projectsGet: (): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:get'),
  onProjectsUpdated: (cb: (snapshot: ProjectsSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: ProjectsSnapshot): void => cb(snapshot)
    ipcRenderer.on('projects:updated', listener)
    return () => ipcRenderer.removeListener('projects:updated', listener)
  },
  projectsCreate: (input: CreateProjectInput): Promise<Project> => ipcRenderer.invoke('projects:create', input),
  projectsRename: (id: string, name: string): Promise<void> => ipcRenderer.invoke('projects:rename', id, name),
  projectsUpdate: (
    id: string,
    patch: { name?: string; description?: string; icon?: string | null; thumbnail?: string | null }
  ): Promise<void> => ipcRenderer.invoke('projects:update', id, patch),
  projectsPickThumbnail: (): Promise<string | null> => ipcRenderer.invoke('projects:pick-thumbnail'),
  projectsDelete: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
  projectsReorder: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke('projects:reorder', orderedIds),
  projectsAddSite: (
    projectId: string,
    site: { url: string; title: string; faviconUrl: string | null },
    kind: 'site' | 'reference'
  ): Promise<void> => ipcRenderer.invoke('projects:add-site', projectId, site, kind),
  projectsRemoveSite: (projectId: string, url: string): Promise<void> => ipcRenderer.invoke('projects:remove-site', projectId, url),
  projectsMoveSiteKind: (projectId: string, url: string, toKind: 'site' | 'reference'): Promise<void> =>
    ipcRenderer.invoke('projects:move-site-kind', projectId, url, toKind),
  projectsMoveSiteToProject: (fromProjectId: string, toProjectId: string, url: string): Promise<void> =>
    ipcRenderer.invoke('projects:move-site-to-project', fromProjectId, toProjectId, url),
  projectsReorderSites: (projectId: string, kind: 'site' | 'reference', orderedUrls: string[]): Promise<void> =>
    ipcRenderer.invoke('projects:reorder-sites', projectId, kind, orderedUrls),

  referenceBrowseStart: (url: string): Promise<void> => ipcRenderer.invoke('reference:browse-start', url),
  referenceGetBrowserVisible: (): Promise<boolean> => ipcRenderer.invoke('reference:get-browser-visible'),
  onReferenceBrowserVisible: (cb: (visible: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, visible: boolean): void => cb(visible)
    ipcRenderer.on('reference:browser-visible', listener)
    return () => ipcRenderer.removeListener('reference:browser-visible', listener)
  },
  referencesOverlaySelectSite: (projectId: string | null, url: string): Promise<void> =>
    ipcRenderer.invoke('references:overlay-select-site', projectId, url),
  onReferencesOverlaySelectSite: (cb: (projectId: string | null, url: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, projectId: string | null, url: string): void => cb(projectId, url)
    ipcRenderer.on('references:overlay-select-site', listener)
    return () => ipcRenderer.removeListener('references:overlay-select-site', listener)
  },
  referencesOverlayOpenSite: (url: string): Promise<void> => ipcRenderer.invoke('references:overlay-open-site', url),
  onReferencesOverlayOpenSite: (cb: (url: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, url: string): void => cb(url)
    ipcRenderer.on('references:overlay-open-site', listener)
    return () => ipcRenderer.removeListener('references:overlay-open-site', listener)
  },
  appSetActiveView: (view: 'browser' | 'references'): Promise<void> => ipcRenderer.invoke('app:set-active-view', view),
  referenceSessionStart: (projectId: string | null, siteUrl: string): Promise<void> =>
    ipcRenderer.invoke('reference:session-start', projectId, siteUrl),
  referenceSessionEnd: (): Promise<void> => ipcRenderer.invoke('reference:session-end'),
  onReferenceSessionState: (cb: (state: ReferenceSessionState | null) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: ReferenceSessionState | null): void => cb(state)
    ipcRenderer.on('reference:session-state', listener)
    return () => ipcRenderer.removeListener('reference:session-state', listener)
  },
  referenceGetSessionState: (): Promise<ReferenceSessionState | null> => ipcRenderer.invoke('reference:get-session-state'),
  referenceItemsGet: (siteKey: string): Promise<ReferenceItem[]> => ipcRenderer.invoke('reference:items-get', siteKey),
  onReferenceItemsUpdated: (cb: (items: ReferenceItem[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, items: ReferenceItem[]): void => cb(items)
    ipcRenderer.on('reference-items:updated', listener)
    return () => ipcRenderer.removeListener('reference-items:updated', listener)
  },
  referenceItemsUpdateMeta: (id: string, patch: { name?: string; description?: string }): Promise<void> =>
    ipcRenderer.invoke('reference:items-update-meta', id, patch),
  referenceItemsRemove: (id: string): Promise<void> => ipcRenderer.invoke('reference:items-remove', id),
  referenceItemsCreateFromPending: (name: string, description?: string): Promise<void> =>
    ipcRenderer.invoke('reference:items-create-from-pending', name, description),
  referenceItemsSend: (
    id: string,
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<ImportResult> =>
    ipcRenderer.invoke('reference:items-send', id, useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),
  referenceItemsSendAll: (
    siteKey: string,
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ): Promise<QueueImportResult> =>
    ipcRenderer.invoke('reference:items-send-all', siteKey, useMatchedTextStyles, useMatchedColorStyles, colorMatchSource),

  standaloneReferencesGet: (): Promise<StandaloneReferenceSite[]> => ipcRenderer.invoke('standalone-references:get'),
  onStandaloneReferencesUpdated: (cb: (sites: StandaloneReferenceSite[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sites: StandaloneReferenceSite[]): void => cb(sites)
    ipcRenderer.on('standalone-references:updated', listener)
    return () => ipcRenderer.removeListener('standalone-references:updated', listener)
  },
  standaloneReferencesRemove: (url: string): Promise<void> => ipcRenderer.invoke('standalone-references:remove', url),
  standaloneReferencesAttachToProject: (url: string, projectId: string): Promise<void> =>
    ipcRenderer.invoke('standalone-references:attach-to-project', url, projectId),

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
