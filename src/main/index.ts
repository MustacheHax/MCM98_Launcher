import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  type OpenDialogOptions
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { isTextSize } from '@shared/textSize'
import { isThemeId, themeMode } from '@shared/themes'
import type {
  AppInfo,
  BackupResult,
  HealthResponse,
  InstallRequest,
  InstallTask,
  InstalledProduct,
  LauncherConfig,
  LauncherLayout,
  LauncherUpdateInfo,
  PlayState,
  Platform,
  SaveInfo,
  WindowBounds
} from '@shared/types'
import { loadCatalog } from './catalogCache'
import {
  ConfigStore,
  isLauncherLayout,
  isLaunchView,
  normalizeBackendUrl,
  normalizeInstallRoot
} from './config'
import { productDirectory } from './library'
import { InstallManager } from './installer'
import { LaunchService } from './launch'
import { LibraryService } from './library'
import { Logger } from './logger'
import { PlayStateStore } from './playState'
import { checkBackend } from './relay'
import { defaultSaveRoots } from './saveRoots'
import { backupSaves, detectSaveDirectory } from './saves'
import { LauncherUpdater } from './updater'

app.setName('MCM98 Launcher')

const SUPPORTED_PLATFORMS: Platform[] = ['win32', 'linux', 'darwin']
const smokeTest = process.argv.includes('--smoke-test')

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let mainReadyToShow = false
let splashSettled = false
let logger: Logger
let config: ConfigStore
let library: LibraryService
let launch: LaunchService
let installer: InstallManager
let updater: LauncherUpdater
let playState: PlayStateStore

function currentPlatform(): Platform {
  if (!SUPPORTED_PLATFORMS.includes(process.platform as Platform)) {
    throw new Error(`The launcher does not support the ${process.platform} platform.`)
  }
  return process.platform as Platform
}

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (splashWindow && !splashSettled) return
  mainWindow.show()
  mainWindow.focus()
}

function applyWindowTheme(): void {
  if (!mainWindow || process.platform !== 'win32') return
  const dark = themeMode(config.get().theme) === 'dark'
  mainWindow.setBackgroundColor(dark ? '#08090c' : '#f3f4ef')
  try {
    mainWindow.setTitleBarOverlay({
      color: dark ? '#08090c' : '#f7f8f3',
      symbolColor: dark ? '#9aa3b2' : '#485040',
      height: 40
    })
  } catch {
    // Older Windows builds may not support the overlay API.
  }
}

async function safeOpenExternal(value: string): Promise<void> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('That link is invalid.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https links can be opened.')
  }
  await shell.openExternal(url.toString())
}

const WINDOW_SIZES: Record<
  LauncherLayout,
  { width: number; height: number; minWidth: number; minHeight: number }
> = {
  compact: { width: 1080, height: 700, minWidth: 940, minHeight: 620 },
  full: { width: 1340, height: 860, minWidth: 1040, minHeight: 680 }
}

/** Bounds the window can be restored to, ignoring maximized/fullscreen states. */
function currentBounds(target: BrowserWindow): WindowBounds | null {
  if (target.isMaximized() || target.isFullScreen() || target.isMinimized()) return null
  const position = target.getPosition()
  const size = target.getSize()
  const x = position[0]
  const y = position[1]
  const width = size[0]
  const height = size[1]
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return null
  }
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null
  return { x, y, width, height }
}

function sameBounds(a: WindowBounds | undefined, b: WindowBounds): boolean {
  return Boolean(
    a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

/** A saved position is only reused when part of it lands on a connected display. */
function isOnScreen(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapWidth =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapWidth >= 120 && overlapHeight >= 80
  })
}

function appIconPath(): string | undefined {
  // Only `out/**` is packaged, so the repository's high-resolution icon is
  // absent from an installed build. The renderer's copy always ships and keeps
  // the taskbar and window icon instead of falling back to the Electron default.
  return [join(__dirname, '../../build/icon.png'), join(__dirname, '../renderer/app-icon.png')].find(
    (candidate) => existsSync(candidate)
  )
}

/** Keeps the compact and full shells at their intended window sizes. */
function applyWindowLayout(target: BrowserWindow, layout: LauncherLayout): void {
  const size = WINDOW_SIZES[layout]
  target.setMinimumSize(size.minWidth, size.minHeight)
  if (target.isMaximized() || target.isFullScreen() || target.isMinimized()) return

  const area = screen.getDisplayMatching(target.getBounds()).workArea
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const bounds = target.getBounds()
  const x = Math.min(Math.max(bounds.x, area.x), Math.max(area.x, area.x + area.width - width))
  const y = Math.min(Math.max(bounds.y, area.y), Math.max(area.y, area.y + area.height - height))

  if (bounds.width !== width || bounds.height !== height) {
    target.setBounds({ x, y, width, height })
  }
}

function applyLoginItem(enabled: boolean): void {
  // Registering a development build would point the OS at an ephemeral
  // electron.exe path, so only installed builds participate.
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (error) {
    logger?.warn('Could not update the sign-in launch setting.', error)
  }
}

function revealMainWindow(): void {
  if (!mainWindow || !mainReadyToShow) return
  if (splashWindow && !splashSettled) return
  if (!smokeTest) mainWindow.show()
}

async function createSplashWindow(): Promise<void> {
  if (smokeTest || !config.get().showSplash) {
    splashSettled = true
    return
  }

  splashSettled = false
  const window = new BrowserWindow({
    width: 820,
    height: 462,
    frame: false,
    show: false,
    center: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#05060a',
    title: 'MCM98 Launcher',
    ...(appIconPath() ? { icon: appIconPath() } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  splashWindow = window
  logger.info('Showing the boot splash.')

  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    splashSettled = true
    if (splashWindow === window) splashWindow = null
    logger.info('Boot splash closed.')
    revealMainWindow()
  })

  const fallback = setTimeout(() => {
    if (!window.isDestroyed()) window.close()
  }, 7_000)
  window.once('closed', () => clearTimeout(fallback))

  window.webContents.once(
    'did-fail-load',
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame) return
      logger.warn(`Splash screen failed to load: ${errorCode} ${errorDescription}`)
      if (!window.isDestroyed()) window.close()
    }
  )

  try {
    const query = config.get().animations ? '' : '?still=1'
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      await window.loadURL(`${rendererUrl.replace(/\/$/, '')}/splash.html${query}`)
    } else {
      await window.loadFile(join(__dirname, '../renderer/splash.html'), {
        search: query ? query.slice(1) : undefined
      })
    }
  } catch (error) {
    logger.warn('Could not show the splash screen.', error)
    if (!window.isDestroyed()) window.close()
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, (): LauncherConfig => config.get())

  ipcMain.handle(
    IPC.saveConfig,
    async (_event, input: Partial<LauncherConfig>): Promise<LauncherConfig> => {
      const previousRoot = config.get().installRoot
      const patch: Partial<LauncherConfig> = {}
      if (typeof input?.backendUrl === 'string') patch.backendUrl = input.backendUrl
      if (typeof input?.installRoot === 'string') patch.installRoot = input.installRoot
      if (isThemeId(input?.theme)) patch.theme = input.theme
      if (isTextSize(input?.textSize)) patch.textSize = input.textSize
      if (isLauncherLayout(input?.layout)) patch.layout = input.layout
      if (isLaunchView(input?.startView)) patch.startView = input.startView
      if (typeof input?.showSplash === 'boolean') patch.showSplash = input.showSplash
      if (typeof input?.animations === 'boolean') patch.animations = input.animations
      if (typeof input?.launchAtLogin === 'boolean') patch.launchAtLogin = input.launchAtLogin
      if (typeof input?.autoCheckLauncher === 'boolean') {
        patch.autoCheckLauncher = input.autoCheckLauncher
      }
      if (typeof input?.autoCheckProducts === 'boolean') {
        patch.autoCheckProducts = input.autoCheckProducts
      }
      if (typeof input?.confirmUninstall === 'boolean') {
        patch.confirmUninstall = input.confirmUninstall
      }
      if (input?.skippedUpdates && typeof input.skippedUpdates === 'object') {
        patch.skippedUpdates = input.skippedUpdates as Record<string, string>
      }
      if (input?.windowBounds && typeof input.windowBounds === 'object') {
        patch.windowBounds = input.windowBounds as Partial<Record<LauncherLayout, WindowBounds>>
      }

      if (
        patch.installRoot !== undefined &&
        normalizeInstallRoot(patch.installRoot) !== previousRoot &&
        installer.hasActiveTasks()
      ) {
        throw new Error('Wait for active downloads to finish before changing the install folder.')
      }

      const saved = config.update(patch)
      if (patch.theme !== undefined) applyWindowTheme()
      if (patch.layout !== undefined && mainWindow) applyWindowLayout(mainWindow, saved.layout)
      if (patch.launchAtLogin !== undefined) applyLoginItem(saved.launchAtLogin)
      if (patch.autoCheckLauncher !== undefined) updater.setAutoCheck(saved.autoCheckLauncher)
      if (saved.installRoot !== previousRoot) {
        await installer.recover()
        broadcast(IPC.libraryChanged)
      }
      if (patch.backendUrl !== undefined) {
        void updater.check()
      }
      return saved
    }
  )

  ipcMain.handle(IPC.chooseInstallRoot, async (): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: 'Choose where games and apps are installed',
      defaultPath: config.get().installRoot,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.testBackend, async (_event, url: string): Promise<HealthResponse> => {
    const normalized = normalizeBackendUrl(String(url ?? ''))
    return checkBackend(normalized, logger)
  })

  ipcMain.handle(IPC.getAppInfo, (): AppInfo => {
    const current = config.get()
    return {
      version: app.getVersion(),
      platform: currentPlatform(),
      arch: process.arch,
      isPackaged: app.isPackaged,
      installRoot: current.installRoot,
      dataRoot: config.dataRoot,
      logPath: config.logPath
    }
  })

  ipcMain.handle(IPC.fetchCatalog, async () => {
    return loadCatalog(config.get(), config.dataRoot, currentPlatform(), logger)
  })

  ipcMain.handle(IPC.getLauncherUpdate, (): LauncherUpdateInfo => updater.getInfo())

  ipcMain.handle(IPC.checkLauncherUpdate, (): Promise<LauncherUpdateInfo> => {
    return updater.check()
  })

  ipcMain.handle(IPC.downloadLauncherUpdate, (): Promise<LauncherUpdateInfo> => {
    return updater.download()
  })

  ipcMain.handle(IPC.installLauncherUpdate, (): Promise<void> => {
    return updater.install()
  })

  ipcMain.handle(IPC.listLibrary, (): Promise<InstalledProduct[]> => library.list())

  ipcMain.handle(IPC.startInstall, (_event, request: InstallRequest): InstallTask => {
    return installer.startInstall(request)
  })

  ipcMain.handle(IPC.cancelInstall, (_event, taskId: string): void => {
    installer.cancelInstall(String(taskId ?? ''))
  })

  ipcMain.handle(IPC.getTasks, (): InstallTask[] => installer.getTasks())

  ipcMain.handle(IPC.clearFinishedTasks, (): void => {
    installer.clearFinished()
  })

  ipcMain.handle(IPC.discardPartials, async (_event, productId: string): Promise<void> => {
    const id = String(productId ?? '')
    if (installer.hasActiveProduct(id)) {
      throw new Error('Stop the download before discarding its partial file.')
    }
    await installer.clearPartials(id)
  })

  ipcMain.handle(IPC.uninstall, async (_event, productId: string): Promise<void> => {
    const id = String(productId ?? '')
    await launch.ensureStopped(id)
    if (installer.hasActiveProduct(id)) {
      throw new Error('Wait for the current install to finish before uninstalling.')
    }
    await library.uninstall(id)
    await installer.clearPartials(id)
    broadcast(IPC.libraryChanged)
  })

  ipcMain.handle(IPC.launch, async (_event, productId: string) => {
    return launch.launch(String(productId ?? ''))
  })

  ipcMain.handle(IPC.getRunning, (): string[] => launch.getRunning())

  ipcMain.handle(IPC.getPlayState, (): PlayState => launch.getPlayState())

  ipcMain.handle(IPC.getSaveInfo, async (_event, productId: string): Promise<SaveInfo> => {
    const product = await library.read(String(productId ?? ''))
    if (!product) throw new Error('That product is not installed.')
    return detectSaveDirectory(product, defaultSaveRoots())
  })

  ipcMain.handle(IPC.openSaveFolder, async (_event, productId: string): Promise<void> => {
    const product = await library.read(String(productId ?? ''))
    if (!product) throw new Error('That product is not installed.')
    const info = await detectSaveDirectory(product, defaultSaveRoots())
    if (!info.path) {
      throw new Error(
        'No save folder was detected for this product. Open the install folder to look for one.'
      )
    }
    const error = await shell.openPath(info.path)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.backupSaves, async (_event, productId: string): Promise<BackupResult> => {
    const product = await library.read(String(productId ?? ''))
    if (!product) throw new Error('That product is not installed.')
    return backupSaves(product, config.dataRoot, logger, defaultSaveRoots())
  })

  ipcMain.handle(
    IPC.openPath,
    async (
      _event,
      target: 'installRoot' | 'product' | 'data',
      productId?: string
    ): Promise<void> => {
      let pathToOpen = config.get().installRoot
      if (target === 'product') {
        const id = String(productId ?? '')
        pathToOpen = productDirectory(config.get().installRoot, id)
      } else if (target === 'data') {
        pathToOpen = config.dataRoot
      }
      if (!existsSync(pathToOpen)) throw new Error('That folder does not exist yet.')
      const error = await shell.openPath(pathToOpen)
      if (error) throw new Error(error)
    }
  )

  ipcMain.handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    await safeOpenExternal(String(url ?? ''))
  })
}

async function createWindow(): Promise<void> {
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  const darkShell = themeMode(config.get().theme) === 'dark'
  const layout = config.get().layout
  const size = WINDOW_SIZES[layout]
  const savedBounds = config.get().windowBounds[layout]
  const restored = savedBounds && isOnScreen(savedBounds) ? savedBounds : null
  mainReadyToShow = false
  const window = new BrowserWindow({
    width: restored?.width ?? size.width,
    height: restored?.height ?? size.height,
    ...(restored ? { x: restored.x, y: restored.y } : {}),
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    show: false,
    title: 'MCM98 Launcher',
    backgroundColor: darkShell ? '#08090c' : '#f3f4ef',
    ...(appIconPath() ? { icon: appIconPath() } : {}),
    autoHideMenuBar: !isMac,
    titleBarStyle: isWindows ? 'hidden' : isMac ? 'hiddenInset' : 'default',
    ...(isWindows
      ? {
          titleBarOverlay: {
            color: darkShell ? '#08090c' : '#f7f8f3',
            symbolColor: darkShell ? '#9aa3b2' : '#485040',
            height: 40
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = window

  const persistBounds = (): void => {
    const snapshot = currentBounds(window)
    if (!snapshot) return
    const current = config.get()
    if (sameBounds(current.windowBounds[current.layout], snapshot)) return
    try {
      config.update({ windowBounds: { ...current.windowBounds, [current.layout]: snapshot } })
    } catch (error) {
      logger.warn('Could not save the window position.', error)
    }
  }

  let boundsTimer: NodeJS.Timeout | null = null
  const schedulePersistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      persistBounds()
    }, 700)
    boundsTimer.unref()
  }

  window.on('resize', schedulePersistBounds)
  window.on('move', schedulePersistBounds)
  window.on('close', () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    persistBounds()
  })

  window.on('closed', () => {
    mainWindow = null
    mainReadyToShow = false
  })

  window.once('ready-to-show', () => {
    mainReadyToShow = true
    logger.info('Main window ready.')
    revealMainWindow()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void safeOpenExternal(url).catch((error) => logger.warn('Blocked external link.', error))
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) {
      event.preventDefault()
      void safeOpenExternal(targetUrl).catch((error) =>
        logger.warn('Blocked in-app navigation.', error)
      )
    }
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone: ${details.reason}`)
  })

  if (smokeTest) {
    const timer = setTimeout(() => {
      logger.error('[smoke] renderer did not load in time')
      app.exit(1)
    }, 20_000)

    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            const result = (await window.webContents.executeJavaScript(`
              ({
                bridge: Boolean(window.launcher),
                rootChildren: document.getElementById('root')?.childElementCount ?? 0,
                relay: (document.querySelector('.statusbar')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                theme: document.documentElement.dataset.theme || '',
                textSize: document.documentElement.dataset.textSize || '',
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 180)
              })
            `)) as {
              bridge: boolean
              rootChildren: number
              relay: string
              theme: string
              textSize: string
              text: string
            }

            if (!result.bridge || result.rootChildren === 0) {
              logger.error(`[smoke] renderer did not initialize: ${JSON.stringify(result)}`)
              clearTimeout(timer)
              app.exit(1)
              return
            }

            clearTimeout(timer)
            console.log(`[smoke] renderer loaded successfully: ${JSON.stringify(result)}`)
            app.exit(0)
          } catch (error) {
            clearTimeout(timer)
            logger.error('[smoke] renderer probe failed.', error)
            app.exit(1)
          }
        })()
      }, 1_500)
    })

    window.webContents.once(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return
        clearTimeout(timer)
        logger.error(`[smoke] renderer failed to load: ${errorCode} ${errorDescription}`)
        app.exit(1)
      }
    )
  }

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    await window.loadURL(rendererUrl)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  const dataRoot = app.getPath('userData')
  logger = new Logger(join(dataRoot, 'logs', 'launcher.log'))
  logger.info(`Starting MCM98 Launcher ${app.getVersion()} on ${process.platform}/${process.arch}.`)

  if (!SUPPORTED_PLATFORMS.includes(process.platform as Platform)) {
    dialog.showErrorBox(
      'Unsupported platform',
      `MCM98 Launcher supports Windows, macOS, and Linux. Detected: ${process.platform}.`
    )
    app.quit()
    return
  }

  config = new ConfigStore(logger)
  library = new LibraryService(config, logger)
  playState = new PlayStateStore(join(config.dataRoot, 'play-state.json'), logger)
  launch = new LaunchService(library, logger, playState, (ids, state) => {
    broadcast(IPC.runningChanged, ids)
    broadcast(IPC.playStateChanged, state)
  })
  installer = new InstallManager({
    config,
    library,
    launch,
    logger,
    emitTasks: (tasks) => broadcast(IPC.tasksChanged, tasks),
    emitLibraryChanged: () => broadcast(IPC.libraryChanged)
  })

  await installer.recover()
  launch.resume()
  updater = new LauncherUpdater(config, currentPlatform(), logger, (info) => {
    broadcast(IPC.launcherUpdateChanged, info)
  })
  registerIpc()
  applyLoginItem(config.get().launchAtLogin)

  if (!process.platform.startsWith('darwin')) {
    Menu.setApplicationMenu(null)
  }

  await createSplashWindow()
  await createWindow()
  updater.setAutoCheck(config.get().autoCheckLauncher)
  logger.info(`Install library: ${config.get().installRoot}`)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    dialog.showErrorBox('MCM98 Launcher could not start', message)
    app.exit(1)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    } else {
      focusMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    updater?.stop()
  })

  process.on('uncaughtException', (error) => {
    logger?.error('Uncaught exception in the main process.', error)
  })
  process.on('unhandledRejection', (reason) => {
    logger?.error('Unhandled promise rejection in the main process.', reason)
  })
}
