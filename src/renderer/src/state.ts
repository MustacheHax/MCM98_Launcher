import { createContext, useContext } from 'react'
import type {
  AppInfo,
  CatalogResponse,
  InstallTask,
  InstalledProduct,
  LauncherConfig,
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
  library: InstalledProduct[]
  tasks: InstallTask[]
  running: string[]
  demoMode: boolean
  busyProductId: string | null
  selected: ProductEntry | null
  openProduct: (product: ProductEntry) => void
  closeProduct: () => void
  refreshCatalog: () => Promise<void>
  refreshLibrary: () => Promise<void>
  install: (product: ProductEntry) => Promise<void>
  launch: (productId: string) => Promise<void>
  requestUninstall: (product: InstalledProduct) => void
  openFolder: (productId?: string) => Promise<void>
  openDataFolder: () => Promise<void>
  saveSettings: (patch: Partial<LauncherConfig>) => Promise<void>
  cancelTask: (taskId: string) => Promise<void>
  clearFinished: () => Promise<void>
  toast: (message: string, kind?: ToastKind) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside the launcher app.')
  return value
}
