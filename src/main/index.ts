import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type OpenDialogOptions
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import type {
  AppInfo,
  HealthResponse,
  InstallRequest,
  InstallTask,
  InstalledProduct,
  LauncherConfig,
  LauncherUpdateInfo,
  Platform
} from '@shared/types'
import { ConfigStore, normalizeBackendUrl, normalizeInstallRoot } from './config'
import { productDirectory } from './library'
import { InstallManager } from './installer'
import { LaunchService } from './launch'
import { LibraryService } from './library'
import { Logger } from './logger'
import { checkBackend, fetchCatalog } from './relay'
import { LauncherUpdater } from './updater'

app.setName('MCM98 Launcher')

const SUPPORTED_PLATFORMS: Platform[] = ['win32', 'linux', 'darwin']
const smokeTest = process.argv.includes('--smoke-test')

let mainWindow: BrowserWindow | null = null
let logger: Logger
let config: ConfigStore
let library: LibraryService
let launch: LaunchService
let installer: InstallManager
let updater: LauncherUpdater

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
  mainWindow.show()
  mainWindow.focus()
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

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, (): LauncherConfig => config.get())

  ipcMain.handle(
    IPC.saveConfig,
    async (_event, input: Partial<LauncherConfig>): Promise<LauncherConfig> => {
      const previousRoot = config.get().installRoot
      const patch: Partial<LauncherConfig> = {}
      if (typeof input?.backendUrl === 'string') patch.backendUrl = input.backendUrl
      if (typeof input?.installRoot === 'string') patch.installRoot = input.installRoot

      if (
        patch.installRoot !== undefined &&
        normalizeInstallRoot(patch.installRoot) !== previousRoot &&
        installer.hasActiveTasks()
      ) {
        throw new Error('Wait for active downloads to finish before changing the install folder.')
      }

      const saved = config.update(patch)
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
    return fetchCatalog(config.get(), currentPlatform(), logger)
  })

  ipcMain.handle(IPC.getLauncherUpdate, (): LauncherUpdateInfo => updater.getInfo())

  ipcMain.handle(IPC.checkLauncherUpdate, (): Promise<LauncherUpdateInfo> => {
    return updater.check()
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

  ipcMain.handle(IPC.uninstall, async (_event, productId: string): Promise<void> => {
    const id = String(productId ?? '')
    await launch.ensureStopped(id)
    if (installer.hasActiveProduct(id)) {
      throw new Error('Wait for the current install to finish before uninstalling.')
    }
    await library.uninstall(id)
    broadcast(IPC.libraryChanged)
  })

  ipcMain.handle(IPC.launch, async (_event, productId: string) => {
    return launch.launch(String(productId ?? ''))
  })

  ipcMain.handle(IPC.getRunning, (): string[] => launch.getRunning())

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

  const window = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'MCM98 Launcher',
    backgroundColor: '#08090c',
    autoHideMenuBar: !isMac,
    titleBarStyle: isWindows ? 'hidden' : isMac ? 'hiddenInset' : 'default',
    ...(isWindows
      ? {
          titleBarOverlay: {
            color: '#08090c',
            symbolColor: '#9aa3b2',
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

  window.on('closed', () => {
    mainWindow = null
  })

  window.once('ready-to-show', () => {
    if (!smokeTest) window.show()
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
                relay: (document.querySelector('.relay-card')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 180)
              })
            `)) as { bridge: boolean; rootChildren: number; relay: string; text: string }

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
  launch = new LaunchService(library, logger, (ids) => broadcast(IPC.runningChanged, ids))
  installer = new InstallManager({
    config,
    library,
    launch,
    logger,
    emitTasks: (tasks) => broadcast(IPC.tasksChanged, tasks),
    emitLibraryChanged: () => broadcast(IPC.libraryChanged)
  })

  await installer.recover()
  updater = new LauncherUpdater(config, currentPlatform(), logger, (info) => {
    broadcast(IPC.launcherUpdateChanged, info)
  })
  registerIpc()

  if (!process.platform.startsWith('darwin')) {
    Menu.setApplicationMenu(null)
  }

  await createWindow()
  updater.start()
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
