import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type {
  AppInfo,
  CatalogResponse,
  HealthResponse,
  InstallRequest,
  InstallTask,
  InstalledProduct,
  LauncherApi,
  LauncherConfig,
  LauncherUpdateInfo
} from '@shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: LauncherApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig) as Promise<LauncherConfig>,
  saveConfig: (patch) =>
    ipcRenderer.invoke(IPC.saveConfig, patch) as Promise<LauncherConfig>,
  chooseInstallRoot: () =>
    ipcRenderer.invoke(IPC.chooseInstallRoot) as Promise<string | null>,
  testBackend: (url) =>
    ipcRenderer.invoke(IPC.testBackend, url) as Promise<HealthResponse>,
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
  fetchCatalog: () => ipcRenderer.invoke(IPC.fetchCatalog) as Promise<CatalogResponse>,
  getLauncherUpdate: () =>
    ipcRenderer.invoke(IPC.getLauncherUpdate) as Promise<LauncherUpdateInfo>,
  checkLauncherUpdate: () =>
    ipcRenderer.invoke(IPC.checkLauncherUpdate) as Promise<LauncherUpdateInfo>,
  downloadLauncherUpdate: () =>
    ipcRenderer.invoke(IPC.downloadLauncherUpdate) as Promise<LauncherUpdateInfo>,
  installLauncherUpdate: () =>
    ipcRenderer.invoke(IPC.installLauncherUpdate) as Promise<void>,

  listLibrary: () => ipcRenderer.invoke(IPC.listLibrary) as Promise<InstalledProduct[]>,
  startInstall: (request: InstallRequest) =>
    ipcRenderer.invoke(IPC.startInstall, request) as Promise<InstallTask>,
  cancelInstall: (taskId) => ipcRenderer.invoke(IPC.cancelInstall, taskId) as Promise<void>,
  getTasks: () => ipcRenderer.invoke(IPC.getTasks) as Promise<InstallTask[]>,
  clearFinishedTasks: () => ipcRenderer.invoke(IPC.clearFinishedTasks) as Promise<void>,
  uninstall: (productId) => ipcRenderer.invoke(IPC.uninstall, productId) as Promise<void>,

  launch: (productId) =>
    ipcRenderer.invoke(IPC.launch, productId) as Promise<{ pid: number }>,
  getRunning: () => ipcRenderer.invoke(IPC.getRunning) as Promise<string[]>,

  openPath: (target, productId) =>
    ipcRenderer.invoke(IPC.openPath, target, productId) as Promise<void>,
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url) as Promise<void>,

  onTasks: (callback) => subscribe<InstallTask[]>(IPC.tasksChanged, callback),
  onLibraryChanged: (callback) => subscribe<void>(IPC.libraryChanged, () => callback()),
  onRunningChanged: (callback) => subscribe<string[]>(IPC.runningChanged, callback),
  onLauncherUpdate: (callback) =>
    subscribe<LauncherUpdateInfo>(IPC.launcherUpdateChanged, callback)
}

contextBridge.exposeInMainWorld('launcher', api)
