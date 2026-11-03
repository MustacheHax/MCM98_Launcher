import { createContext, useContext } from 'react'
import type { ThemeId } from '@shared/themes'
import type {
  AppInfo,
  CatalogResponse,
  InstallTask,
  InstalledProduct,
  LauncherConfig,
  LauncherUpdateInfo,
  PlayState,
  ProductEntry
} from '@shared/types'

export type View = 'library' | 'catalog' | 'downloads' | 'settings'
export type ToastKind = 'info' | 'success' | 'error'

export interface AppContextValue {
  view: View
  navigate: (view: View) => void
  search: string
  setSearch: (value: string) => void
  config: LauncherConfig | null
  appInfo: AppInfo | null
  catalog: CatalogResponse | null
  catalogLoading: boolean
  catalogError: string | null
  launcherUpdate: LauncherUpdateInfo | null
  dismissedUpdateVersion: string | null
  theme: ThemeId
  library: InstalledProduct[]
  tasks: InstallTask[]
  running: string[]
  playState: PlayState
  demoMode: boolean
  busyProductId: string | null
  repairingId: string | null
  selected: ProductEntry | null
  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  openProduct: (product: ProductEntry) => void
  closeProduct: () => void
  refreshCatalog: () => Promise<void>
  refreshLibrary: () => Promise<void>
  checkLauncherUpdate: () => Promise<void>
  downloadLauncherUpdate: () => Promise<void>
  installLauncherUpdate: () => Promise<void>
  dismissLauncherUpdate: () => void
  setTheme: (theme: ThemeId) => Promise<void>
  openExternal: (url: string) => Promise<void>
  install: (product: ProductEntry) => Promise<void>
  repair: (product: ProductEntry) => Promise<void>
  updateAll: () => Promise<void>
  /** Comparable version of an available update, or null when there is none. */
  updateFor: (product: ProductEntry) => string | null
  /** True when the newest available update was explicitly skipped. */
  isUpdateSkipped: (product: ProductEntry) => boolean
  skipUpdate: (product: ProductEntry) => Promise<void>
  unskipUpdate: (productId: string) => Promise<void>
  launch: (productId: string) => Promise<void>
  requestUninstall: (product: InstalledProduct) => void
  openFolder: (productId?: string) => Promise<void>
  openDataFolder: () => Promise<void>
  saveSettings: (patch: Partial<LauncherConfig>) => Promise<void>
  cancelTask: (taskId: string) => Promise<void>
  clearFinished: () => Promise<void>
  /** Removes a partial download kept for resuming this product. */
  discardPartials: (productId: string) => Promise<void>
  toast: (message: string, kind?: ToastKind) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside the launcher app.')
  return value
}
