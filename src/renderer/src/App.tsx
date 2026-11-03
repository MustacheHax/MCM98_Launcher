import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_TEXT_SIZE, isTextSize, type TextSize } from '@shared/textSize'
import { DEFAULT_THEME, isThemeId, themeMode, type ThemeId } from '@shared/themes'
import type {
  AppInfo,
  CatalogResponse,
  InstallPhase,
  InstallRequest,
  InstallTask,
  InstalledProduct,
  LauncherApi,
  LauncherConfig,
  LauncherUpdateInfo,
  PlayState,
  ProductEntry
} from '@shared/types'
import { errorMessage, demoMode, getLauncher } from './api'
import { AppContext, type ToastKind, type View } from './state'
import {
  activeTaskFor,
  isTerminalPhase,
  isUpdateAvailable,
  versionFromRelease,
  versionLabel
} from './utils'
import { CommandPalette } from './components/CommandPalette'
import { Sidebar, TitleBar } from './components/Chrome'
import { StatusBar } from './components/StatusBar'
import { CatalogView } from './components/CatalogView'
import { LibraryView } from './components/LibraryView'
import { DownloadsView } from './components/DownloadsView'
import { SettingsView } from './components/SettingsView'
import { ProductDrawer } from './components/ProductDrawer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { LauncherUpdateBanner } from './components/LauncherUpdateBanner'
import { Toast } from './components/Toast'

interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

const VIEW_ORDER: View[] = ['library', 'catalog', 'downloads', 'settings']

function toInstallRequest(product: ProductEntry): InstallRequest {
  const release = product.release
  if (!release) throw new Error('This product has no installable release.')
  return {
    productId: product.id,
    name: product.name,
    version: versionFromRelease(release),
    repo: product.repo,
    releaseUrl: release.url,
    assetName: release.asset.name,
    downloadUrl: release.asset.downloadUrl,
    sizeBytes: release.asset.size,
    digest: release.asset.digest,
    executable: product.install?.executable ?? null,
    args: product.install?.args ?? []
  }
}

function App(): JSX.Element {
  const [boot] = useState<{ api: LauncherApi | null; error: string | null }>(() => {
    try {
      return { api: getLauncher(), error: null }
    } catch (error) {
      return { api: null, error: errorMessage(error) }
    }
  })
  const bridge = boot.api

  const [config, setConfig] = useState<LauncherConfig | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [launcherUpdate, setLauncherUpdate] = useState<LauncherUpdateInfo | null>(null)
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const [library, setLibrary] = useState<InstalledProduct[]>([])
  const [tasks, setTasks] = useState<InstallTask[]>([])
  const [running, setRunning] = useState<string[]>([])
  const [playState, setPlayState] = useState<PlayState>({})
  const [view, setView] = useState<View>('library')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ProductEntry | null>(null)
  const [busyProductId, setBusyProductId] = useState<string | null>(null)
  const [repairingId, setRepairingId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [confirmProduct, setConfirmProduct] = useState<InstalledProduct | null>(null)
  const [uninstalling, setUninstalling] = useState(false)
  const [toastState, setToastState] = useState<ToastState | null>(null)
  const [bootError, setBootError] = useState<string | null>(boot.error)
  const [theme, setThemeState] = useState<ThemeId>(() => {
    try {
      const cached = window.localStorage.getItem('mcm98.theme')
      return isThemeId(cached) ? cached : DEFAULT_THEME
    } catch {
      return DEFAULT_THEME
    }
  })
  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    try {
      const cached = window.localStorage.getItem('mcm98.textSize')
      return isTextSize(cached) ? cached : DEFAULT_TEXT_SIZE
    } catch {
      return DEFAULT_TEXT_SIZE
    }
  })
  const [layout, setLayoutState] = useState<LauncherConfig['layout']>(() => {
    try {
      return window.localStorage.getItem('mcm98.layout') === 'full' ? 'full' : 'compact'
    } catch {
      return 'compact'
    }
  })
  const [animations, setAnimationsState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('mcm98.animations') !== 'off'
    } catch {
      return true
    }
  })

  useEffect(() => {
    const mode = themeMode(theme)
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.mode = mode
    document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    try {
      window.localStorage.setItem('mcm98.theme', theme)
    } catch {
      // A locked-down profile can refuse storage; the saved config still wins.
    }
  }, [theme])

  useEffect(() => {
    if (config?.theme) setThemeState(config.theme)
  }, [config?.theme])

  useEffect(() => {
    if (config?.textSize) setTextSizeState(config.textSize)
  }, [config?.textSize])

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize
    try {
      window.localStorage.setItem('mcm98.textSize', textSize)
    } catch {
      // The saved config still wins when storage is unavailable.
    }
  }, [textSize])

  useEffect(() => {
    if (config) setLayoutState(config.layout)
  }, [config?.layout])

  useEffect(() => {
    if (config) setAnimationsState(config.animations)
  }, [config?.animations])

  useEffect(() => {
    document.documentElement.dataset.layout = layout
    try {
      window.localStorage.setItem('mcm98.layout', layout)
    } catch {
      // The saved config still wins when storage is unavailable.
    }
  }, [layout])

  useEffect(() => {
    document.documentElement.dataset.motion = animations ? 'full' : 'reduced'
    try {
      window.localStorage.setItem('mcm98.animations', animations ? 'on' : 'off')
    } catch {
      // The saved config still wins when storage is unavailable.
    }
  }, [animations])

  const startViewApplied = useRef(false)
  useLayoutEffect(() => {
    if (!config || startViewApplied.current) return
    startViewApplied.current = true
    setView(config.startView)
  }, [config])

  const toastTimer = useRef<number | null>(null)
  const previousPhases = useRef<Map<string, InstallPhase>>(new Map())

  const toast = useCallback((message: string, kind: ToastKind = 'info'): void => {
    setToastState({ id: Date.now(), kind, message })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastState(null), 5_000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const refreshLibrary = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      setLibrary(await bridge.listLibrary())
    } catch (error) {
      console.error('Could not read the library.', error)
    }
  }, [bridge])

  const loadCatalog = useCallback(async (): Promise<void> => {
    if (!bridge) return
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const next = await bridge.fetchCatalog()
      setCatalog(next)
    } catch (error) {
      setCatalogError(errorMessage(error))
    } finally {
      setCatalogLoading(false)
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let alive = true

    const unsubscribeTasks = bridge.onTasks((next) => setTasks(next))
    const unsubscribeLibrary = bridge.onLibraryChanged(() => {
      void refreshLibrary()
    })
    const unsubscribeRunning = bridge.onRunningChanged((ids) => setRunning(ids))
    const unsubscribeUpdate = bridge.onLauncherUpdate((next) => setLauncherUpdate(next))
    const unsubscribePlayState = bridge.onPlayStateChanged((next) => setPlayState(next))

    void (async () => {
      try {
        const [
          cfg,
          info,
          currentTasks,
          currentRunning,
          currentLibrary,
          currentUpdate,
          currentPlayState
        ] = await Promise.all([
          bridge.getConfig(),
          bridge.getAppInfo(),
          bridge.getTasks(),
          bridge.getRunning(),
          bridge.listLibrary(),
          bridge.getLauncherUpdate(),
          bridge.getPlayState()
        ])
        if (!alive) return
        setConfig(cfg)
        setAppInfo(info)
        setTasks(currentTasks)
        setRunning(currentRunning)
        setLibrary(currentLibrary)
        setLauncherUpdate(currentUpdate)
        setPlayState(currentPlayState)
      } catch (error) {
        if (alive) setBootError(errorMessage(error))
      }
    })()

    return () => {
      alive = false
      unsubscribeTasks()
      unsubscribeLibrary()
      unsubscribeRunning()
      unsubscribeUpdate()
      unsubscribePlayState()
    }
  }, [bridge, refreshLibrary])

  const backendUrl = config?.backendUrl
  useEffect(() => {
    if (!backendUrl) return
    void loadCatalog()
  }, [backendUrl, loadCatalog])

  // Keep product update state warm without hammering a sleeping free relay.
  useEffect(() => {
    if (!bridge || !config?.autoCheckProducts) return
    let lastRefresh = Date.now()
    const refreshIfStale = (): void => {
      if (Date.now() - lastRefresh < 5 * 60_000) return
      lastRefresh = Date.now()
      void loadCatalog()
    }
    const interval = window.setInterval(refreshIfStale, 30 * 60_000)
    window.addEventListener('focus', refreshIfStale)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshIfStale)
    }
  }, [bridge, config?.autoCheckProducts, loadCatalog])

  useEffect(() => {
    let completed: InstallTask | null = null

    for (const task of tasks) {
      const previous = previousPhases.current.get(task.id)
      if (previous && !isTerminalPhase(previous)) {
        if (task.phase === 'done') {
          completed = task
          toast(`${task.name} is ready to play.`, 'success')
        } else if (task.phase === 'error') {
          toast(task.error ?? `${task.name} failed to install.`, 'error')
        }
      }
      previousPhases.current.set(task.id, task.phase)
    }

    if (completed) void refreshLibrary()
  }, [tasks, toast, refreshLibrary])

  const startInstall = useCallback(
    async (product: ProductEntry, mode: 'install' | 'repair'): Promise<void> => {
      if (!bridge || !product.release || product.status !== 'ready') return
      if (mode === 'repair') setRepairingId(product.id)
      else setBusyProductId(product.id)
      try {
        await bridge.startInstall(toInstallRequest(product))
        setSelected(null)
        setView('downloads')
        toast(
          mode === 'repair' ? `Repairing ${product.name}` : `Downloading ${product.name}`,
          'info'
        )
      } catch (error) {
        toast(errorMessage(error), 'error')
      } finally {
        if (mode === 'repair') setRepairingId(null)
        else setBusyProductId(null)
      }
    },
    [bridge, toast]
  )

  const install = useCallback(
    (product: ProductEntry) => startInstall(product, 'install'),
    [startInstall]
  )

  const repair = useCallback(
    (product: ProductEntry) => startInstall(product, 'repair'),
    [startInstall]
  )

  const launch = useCallback(
    async (productId: string): Promise<void> => {
      if (!bridge) return
      setBusyProductId(productId)
      try {
        await bridge.launch(productId)
      } catch (error) {
        toast(errorMessage(error), 'error')
      } finally {
        setBusyProductId(null)
      }
    },
    [bridge, toast]
  )

  const openFolder = useCallback(
    async (productId?: string): Promise<void> => {
      if (!bridge) return
      try {
        await bridge.openPath(productId ? 'product' : 'installRoot', productId)
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [bridge, toast]
  )

  const openDataFolder = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      await bridge.openPath('data')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [bridge, toast])

  const openExternal = useCallback(
    async (url: string): Promise<void> => {
      if (!bridge) return
      try {
        await bridge.openExternal(url)
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [bridge, toast]
  )

  const checkLauncherUpdate = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      setLauncherUpdate(await bridge.checkLauncherUpdate())
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [bridge, toast])

  const downloadLauncherUpdate = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      setLauncherUpdate(await bridge.downloadLauncherUpdate())
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [bridge, toast])

  const installLauncherUpdate = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      await bridge.installLauncherUpdate()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [bridge, toast])

  const setTheme = useCallback(
    async (next: ThemeId): Promise<void> => {
      if (!bridge || next === theme) return
      const previous = theme
      setThemeState(next)
      try {
        const saved = await bridge.saveConfig({ theme: next })
        setConfig(saved)
      } catch (error) {
        setThemeState(previous)
        toast(errorMessage(error), 'error')
      }
    },
    [bridge, theme, toast]
  )

  const launcherUpdateKey = launcherUpdate?.latestVersion ?? launcherUpdate?.releaseName ?? null

  const dismissLauncherUpdate = useCallback((): void => {
    if (launcherUpdateKey) setDismissedUpdateVersion(launcherUpdateKey)
  }, [launcherUpdateKey])

  const saveSettings = useCallback(
    async (patch: Partial<LauncherConfig>): Promise<void> => {
      if (!bridge || !config) return
      const previous = config
      const saved = await bridge.saveConfig(patch)
      setConfig(saved)
      setAppInfo((info) => (info ? { ...info, installRoot: saved.installRoot } : info))
      if (saved.installRoot !== previous.installRoot) await refreshLibrary()
      if (saved.backendUrl !== previous.backendUrl) await loadCatalog()
    },
    [bridge, config, refreshLibrary, loadCatalog]
  )

  const installedById = useMemo(
    () => new Map(library.map((product) => [product.id, product])),
    [library]
  )

  const updateFor = useCallback(
    (product: ProductEntry): string | null => {
      if (!product.release) return null
      const installed = installedById.get(product.id)
      if (!installed) return null
      const latest = versionFromRelease(product.release)
      if (!isUpdateAvailable(installed.version, latest)) return null
      if (config?.skippedUpdates?.[product.id] === latest) return null
      return latest
    },
    [installedById, config?.skippedUpdates]
  )

  const isUpdateSkipped = useCallback(
    (product: ProductEntry): boolean => {
      if (!product.release || !config) return false
      const installed = installedById.get(product.id)
      if (!installed) return false
      const latest = versionFromRelease(product.release)
      return (
        isUpdateAvailable(installed.version, latest) &&
        config.skippedUpdates[product.id] === latest
      )
    },
    [installedById, config]
  )

  const skipUpdate = useCallback(
    async (product: ProductEntry): Promise<void> => {
      if (!config || !product.release) return
      const latest = versionFromRelease(product.release)
      try {
        await saveSettings({
          skippedUpdates: { ...config.skippedUpdates, [product.id]: latest }
        })
        toast(`Skipped ${product.name} ${versionLabel(latest)}.`, 'info')
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [config, saveSettings, toast]
  )

  const unskipUpdate = useCallback(
    async (productId: string): Promise<void> => {
      if (!config) return
      const next = { ...config.skippedUpdates }
      delete next[productId]
      try {
        await saveSettings({ skippedUpdates: next })
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [config, saveSettings, toast]
  )

  const updateAll = useCallback(async (): Promise<void> => {
    if (!bridge || !catalog) return
    const targets = catalog.products.filter(
      (product) =>
        updateFor(product) !== null &&
        !running.includes(product.id) &&
        !activeTaskFor(tasks, product.id)
    )
    if (targets.length === 0) {
      toast('Everything installed is already up to date.', 'info')
      return
    }

    let queued = 0
    for (const product of targets) {
      try {
        await bridge.startInstall(toInstallRequest(product))
        queued += 1
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    }
    if (queued > 0) {
      setView('downloads')
      toast(`Queued ${queued} update${queued === 1 ? '' : 's'}.`, 'success')
    }
  }, [bridge, catalog, updateFor, running, tasks, toast])

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (meta && key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setSelected(null)
        return
      }

      // Ctrl/Cmd + 1-4 jumps between the four views.
      if (meta && /^[1-4]$/.test(event.key)) {
        event.preventDefault()
        const target = VIEW_ORDER[Number(event.key) - 1]
        if (target) setView(target)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const cancelTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!bridge) return
      try {
        await bridge.cancelInstall(taskId)
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [bridge, toast]
  )

  const clearFinished = useCallback(async (): Promise<void> => {
    if (!bridge) return
    try {
      await bridge.clearFinishedTasks()
      setTasks(await bridge.getTasks())
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [bridge, toast])

  const discardPartials = useCallback(
    async (productId: string): Promise<void> => {
      if (!bridge) return
      try {
        await bridge.discardPartials(productId)
        toast('Partial download removed.', 'success')
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    },
    [bridge, toast]
  )

  const uninstallProduct = useCallback(
    async (product: InstalledProduct): Promise<void> => {
      if (!bridge) return
      setUninstalling(true)
      try {
        await bridge.uninstall(product.id)
        setConfirmProduct(null)
        setSelected(null)
        await refreshLibrary()
        toast(`${product.name} was uninstalled.`, 'success')
      } catch (error) {
        toast(errorMessage(error), 'error')
      } finally {
        setUninstalling(false)
      }
    },
    [bridge, refreshLibrary, toast]
  )

  const confirmUninstall = useCallback((): void => {
    if (confirmProduct) void uninstallProduct(confirmProduct)
  }, [confirmProduct, uninstallProduct])

  const requestUninstall = useCallback(
    (product: InstalledProduct): void => {
      if (config?.confirmUninstall === false) {
        void uninstallProduct(product)
        return
      }
      setConfirmProduct(product)
    },
    [config?.confirmUninstall, uninstallProduct]
  )

  const navigate = useCallback((next: View): void => {
    setView(next)
  }, [])

  const contextValue = useMemo(
    () => ({
      view,
      navigate,
      search,
      setSearch,
      config,
      appInfo,
      catalog,
      catalogLoading,
      catalogError,
      launcherUpdate,
      dismissedUpdateVersion,
      theme,
      library,
      tasks,
      running,
      playState,
      demoMode,
      busyProductId,
      repairingId,
      selected,
      paletteOpen,
      openPalette,
      closePalette,
      openProduct: (product: ProductEntry) => setSelected(product),
      closeProduct: () => setSelected(null),
      refreshCatalog: loadCatalog,
      refreshLibrary,
      checkLauncherUpdate,
      downloadLauncherUpdate,
      installLauncherUpdate,
      dismissLauncherUpdate,
      setTheme,
      openExternal,
      install,
      repair,
      updateAll,
      updateFor,
      isUpdateSkipped,
      skipUpdate,
      unskipUpdate,
      launch,
      requestUninstall,
      openFolder,
      openDataFolder,
      saveSettings,
      cancelTask,
      clearFinished,
      discardPartials,
      toast
    }),
    [
      view,
      navigate,
      search,
      config,
      appInfo,
      catalog,
      catalogLoading,
      catalogError,
      launcherUpdate,
      dismissedUpdateVersion,
      theme,
      library,
      tasks,
      running,
      playState,
      busyProductId,
      repairingId,
      selected,
      paletteOpen,
      openPalette,
      closePalette,
      loadCatalog,
      refreshLibrary,
      checkLauncherUpdate,
      downloadLauncherUpdate,
      installLauncherUpdate,
      dismissLauncherUpdate,
      setTheme,
      openExternal,
      install,
      repair,
      updateAll,
      updateFor,
      isUpdateSkipped,
      skipUpdate,
      unskipUpdate,
      launch,
      requestUninstall,
      openFolder,
      openDataFolder,
      saveSettings,
      cancelTask,
      clearFinished,
      discardPartials,
      toast
    ]
  )

  if (!appInfo || !config) {
    return <BootScreen error={bootError} />
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div
        className="app"
        data-platform={appInfo.platform}
        data-demo={demoMode ? 'true' : 'false'}
        data-layout={layout}
        data-motion={animations ? 'full' : 'reduced'}
      >
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="main" id="main-content">
            {launcherUpdate?.state === 'available' &&
              launcherUpdateKey &&
              launcherUpdateKey !== dismissedUpdateVersion && (
                <div className="update-banner-slot">
                  <LauncherUpdateBanner
                    update={launcherUpdate}
                    onDismiss={dismissLauncherUpdate}
                    onDownload={() => void downloadLauncherUpdate()}
                    onInstall={() => void installLauncherUpdate()}
                  />
                </div>
              )}
            {view === 'library' && <LibraryView />}
            {view === 'catalog' && <CatalogView />}
            {view === 'downloads' && <DownloadsView />}
            {view === 'settings' && <SettingsView />}
          </main>
        </div>
        <StatusBar />

        {selected && <ProductDrawer />}

        {paletteOpen && <CommandPalette />}

        {confirmProduct && (
          <ConfirmDialog
            product={confirmProduct}
            busy={uninstalling}
            onCancel={() => {
              if (!uninstalling) setConfirmProduct(null)
            }}
            onConfirm={confirmUninstall}
          />
        )}

        {toastState && <Toast state={toastState} />}
      </div>
    </AppContext.Provider>
  )
}

function BootScreen({ error }: { error: string | null }): JSX.Element {
  return (
    <div className="boot-screen">
      <img className="boot-logo" src="./logo.png" alt="MCM98" />
      {error ? (
        <>
          <p className="boot-error">{error}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      ) : (
        <>
          <div className="boot-loader" aria-label="Loading" />
          <p className="boot-note">Preparing your library</p>
        </>
      )}
    </div>
  )
}

export default App
