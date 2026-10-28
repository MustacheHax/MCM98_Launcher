/**
 * Shared contracts for the MCM98 Launcher desktop app and the Render relay.
 * This file is declarations only so both TypeScript builds can consume it
 * without a shared runtime package.
 */

export type Platform = 'win32' | 'linux' | 'darwin'

export type ProductStatus = 'ready' | 'unavailable'

export interface AssetInfo {
  name: string
  size: number
  /** GitHub-provided digest, e.g. "sha256:ab12…", when available. */
  digest: string | null
  downloadUrl: string
  viaRelay: boolean
}

export interface ReleaseInfo {
  tag: string
  name: string
  publishedAt: string
  prerelease: boolean
  url: string
  notes: string | null
  asset: AssetInfo
}

export interface InstallHint {
  executable: string | null
  args: string[]
}

export interface ProductEntry {
  id: string
  name: string
  summary: string
  repo: string
  repoUrl: string
  tags: string[]
  featured: boolean
  status: ProductStatus
  error: string | null
  /** Platform this entry was resolved for. */
  platform: Platform
  availablePlatforms: Platform[]
  release: ReleaseInfo | null
  install: InstallHint | null
}

export interface CatalogResponse {
  backendVersion: string
  generatedAt: string
  platform: Platform
  products: ProductEntry[]
}

export interface HealthResponse {
  ok: boolean
  version: string
  timestamp: string
  catalogProducts: number
  githubAuthenticated: boolean
}

/** A release of the launcher itself, resolved by the relay. */
export interface LauncherReleaseInfo {
  version: string
  tag: string
  name: string
  publishedAt: string
  prerelease: boolean
  url: string
  notes: string | null
  assetName: string | null
  assetSize: number | null
}

export interface LauncherReleaseResponse {
  platform: Platform
  repo: string
  release: LauncherReleaseInfo | null
  error: string | null
}

export type LauncherUpdateState =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'unavailable'
  | 'error'

export interface LauncherUpdateInfo {
  state: LauncherUpdateState
  currentVersion: string
  latestVersion: string | null
  releaseName: string | null
  releaseUrl: string | null
  publishedAt: string | null
  notes: string | null
  assetName: string | null
  assetSize: number | null
  checkedAt: string | null
  error: string | null
}

/* ------------------------------------------------------------------ */
/* Desktop-only contracts                                              */
/* ------------------------------------------------------------------ */

export interface LauncherConfig {
  /** Base URL of the Render relay, without a trailing slash. */
  backendUrl: string
  /** Root folder where products are installed. */
  installRoot: string
}

export interface AppInfo {
  version: string
  platform: Platform
  arch: string
  isPackaged: boolean
  installRoot: string
  dataRoot: string
  logPath: string
}

export interface InstalledProduct {
  id: string
  name: string
  version: string
  repo: string
  releaseUrl: string
  installedAt: string
  updatedAt: string
  /** Relative to the app directory. */
  executable: string | null
  args: string[]
  installPath: string
  appPath: string
  executablePath: string | null
  sizeBytes: number
}

export type InstallPhase =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface InstallTask {
  id: string
  productId: string
  name: string
  version: string
  phase: InstallPhase
  receivedBytes: number
  totalBytes: number
  /** Bytes per second, smoothed while downloading. */
  speedBytesPerSec: number
  message: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface InstallRequest {
  productId: string
  name: string
  version: string
  repo: string
  releaseUrl: string
  assetName: string
  downloadUrl: string
  sizeBytes: number
  digest: string | null
  executable: string | null
  args: string[]
}

export interface LauncherApi {
  getConfig(): Promise<LauncherConfig>
  saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig>
  chooseInstallRoot(): Promise<string | null>
  testBackend(url: string): Promise<HealthResponse>
  getAppInfo(): Promise<AppInfo>
  fetchCatalog(): Promise<CatalogResponse>
  getLauncherUpdate(): Promise<LauncherUpdateInfo>
  checkLauncherUpdate(): Promise<LauncherUpdateInfo>

  listLibrary(): Promise<InstalledProduct[]>
  startInstall(request: InstallRequest): Promise<InstallTask>
  cancelInstall(taskId: string): Promise<void>
  getTasks(): Promise<InstallTask[]>
  clearFinishedTasks(): Promise<void>
  uninstall(productId: string): Promise<void>

  launch(productId: string): Promise<{ pid: number }>
  getRunning(): Promise<string[]>

  openPath(target: 'installRoot' | 'product' | 'data', productId?: string): Promise<void>
  openExternal(url: string): Promise<void>

  onTasks(callback: (tasks: InstallTask[]) => void): () => void
  onLibraryChanged(callback: () => void): () => void
  onRunningChanged(callback: (productIds: string[]) => void): () => void
  onLauncherUpdate(callback: (info: LauncherUpdateInfo) => void): () => void
}

declare global {
  interface Window {
    launcher?: LauncherApi
  }
}
