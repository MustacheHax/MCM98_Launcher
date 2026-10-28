import type {
  AppInfo,
  CatalogResponse,
  HealthResponse,
  InstallRequest,
  InstallTask,
  InstalledProduct,
  LauncherApi,
  LauncherConfig,
  LauncherUpdateInfo,
  ProductEntry,
  Platform
} from '@shared/types'

const DEMO_LIBRARY_ROOT = 'C:\\Games\\MCM98'

const HOLLOW_NOTES = `## 2.1.0 — The Long Static

A new chapter in the array. This update reworks the radio room and adds a second signal to chase.

- New wing: the Transmission Floor
- Rebuilt save system with three manual slots
- 14 new environmental recordings
- Fixed a progression blocker in the antenna yard
- Reduced load times on older drives

Known issue: ultrawide cutscenes still letterbox to 16:9. A fix is in the next patch.`

const DRIFT_NOTES = `## 1.4.2

- Added the Harbour Loop night course
- Ghost replays now keep their headlights
- Fixed a frame-time spike when crossing the bridge
- Improved gamepad deadzone handling`

const FOUNDRY_NOTES = `## 0.9.7

- New texture validation pass
- Batch rename is now undoable
- CLI importer handles uppercase extensions
- Fixed a crash when opening very large atlases`

function makeRelease(
  tag: string,
  publishedAt: string,
  assetName: string,
  size: number,
  notes: string
): ProductEntry['release'] {
  return {
    tag,
    name: tag,
    publishedAt,
    prerelease: false,
    url: 'https://github.com/MCM98',
    notes,
    asset: {
      name: assetName,
      size,
      digest: null,
      downloadUrl: 'https://github.com/MCM98/releases/download/demo/build.zip',
      viaRelay: false
    }
  }
}

function makeProduct(input: {
  id: string
  name: string
  summary: string
  repo: string
  tags: string[]
  featured?: boolean
  available: Platform[]
  release: ProductEntry['release']
  executable: string | null
  error?: string
}): ProductEntry {
  return {
    id: input.id,
    name: input.name,
    summary: input.summary,
    repo: input.repo,
    repoUrl: `https://github.com/${input.repo}`,
    tags: input.tags,
    featured: input.featured ?? false,
    status: input.release ? 'ready' : 'unavailable',
    error: input.error ?? null,
    platform: 'win32',
    availablePlatforms: input.available,
    release: input.release,
    install: input.release ? { executable: input.executable, args: [] } : null
  }
}

function buildCatalogProducts(): ProductEntry[] {
  return [
    makeProduct({
      id: 'hollow-signal',
      name: 'Hollow Signal',
      summary:
        'A short survival-horror vignette set in a decommissioned radio array. Listen carefully. Something on the other end is listening back.',
      repo: 'MCM98/hollow-signal',
      tags: ['game', 'horror', 'narrative'],
      featured: true,
      available: ['win32'],
      release: makeRelease(
        'v2.1.0',
        '2026-10-18T16:40:00Z',
        'HollowSignal-win64.zip',
        2_684_354_560,
        HOLLOW_NOTES
      ),
      executable: 'HollowSignal.exe'
    }),
    makeProduct({
      id: 'drift-circuit',
      name: 'Drift Circuit',
      summary:
        'Late-night street racing through a rain-soaked harbour city. Build a car, learn the lines, own the hill.',
      repo: 'MCM98/drift-circuit',
      tags: ['game', 'racing', 'arcade'],
      available: ['win32', 'linux'],
      release: makeRelease(
        'v1.4.2',
        '2026-10-21T09:12:00Z',
        'DriftCircuit-win64.zip',
        987_654_321,
        DRIFT_NOTES
      ),
      executable: 'DriftCircuit.exe'
    }),
    makeProduct({
      id: 'foundry-tools',
      name: 'Foundry Tools',
      summary:
        'The content pipeline in a box: texture validation, atlas packing, and batch import for the rest of the studio.',
      repo: 'MCM98/foundry-tools',
      tags: ['tool', 'pipeline'],
      available: ['win32'],
      release: makeRelease(
        'v0.9.7',
        '2026-09-30T14:05:00Z',
        'FoundryTools-windows-x64.zip',
        149_331_968,
        FOUNDRY_NOTES
      ),
      executable: 'FoundryTools.exe'
    }),
    makeProduct({
      id: 'night-market',
      name: 'Night Market',
      summary:
        'A quiet narrative sim about running a stall in a city that never quite sleeps. Currently in closed development.',
      repo: 'MCM98/night-market',
      tags: ['game', 'narrative', 'sim'],
      available: [],
      release: null,
      executable: null,
      error: 'This repository has no published releases yet.'
    })
  ]
}

function installedFrom(
  product: ProductEntry,
  version: string,
  date: string,
  sizeBytes: number
): InstalledProduct {
  const installPath = `${DEMO_LIBRARY_ROOT}\\${product.id}`
  const executable = product.install?.executable ?? 'Game.exe'
  return {
    id: product.id,
    name: product.name,
    version,
    repo: product.repo,
    releaseUrl: product.release?.url ?? product.repoUrl,
    installedAt: date,
    updatedAt: date,
    executable,
    args: [],
    installPath,
    appPath: `${installPath}\\app`,
    executablePath: `${installPath}\\app\\${executable.replace(/\//g, '\\')}`,
    sizeBytes
  }
}

function seedLibrary(): InstalledProduct[] {
  const products = buildCatalogProducts()
  const hollow = products.find((product) => product.id === 'hollow-signal') as ProductEntry
  const foundry = products.find((product) => product.id === 'foundry-tools') as ProductEntry
  return [
    installedFrom(hollow, 'v2.0.1', '2026-09-27T20:10:00Z', 2_415_919_104),
    installedFrom(foundry, 'v0.9.7', '2026-10-02T11:30:00Z', 149_331_968)
  ]
}

function cloneTask(task: InstallTask): InstallTask {
  return { ...task }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

export function createDemoApi(): LauncherApi {
  let config: LauncherConfig = {
    backendUrl: 'https://mcm98-launcher-api.onrender.com',
    installRoot: DEMO_LIBRARY_ROOT,
    theme: 'modern-dark',
    layout: 'compact',
    startView: 'library',
    showSplash: true,
    animations: true,
    launchAtLogin: false,
    autoCheckLauncher: true,
    autoCheckProducts: true,
    confirmUninstall: true
  }
  let installed = seedLibrary()
  let sequence = 0

  const tasks = new Map<string, InstallTask>()
  const cancelled = new Set<string>()
  const running = new Set<string>()
  const taskListeners = new Set<(tasks: InstallTask[]) => void>()
  const libraryListeners = new Set<() => void>()
  const runningListeners = new Set<(ids: string[]) => void>()
  const updateListeners = new Set<(info: LauncherUpdateInfo) => void>()
  const timers = new Map<string, { interval: number | null; timeouts: number[] }>()
  let launcherUpdate: LauncherUpdateInfo = {
    state: 'available',
    currentVersion: '0.3.0',
    latestVersion: '0.3.1',
    releaseName: 'Launcher 0.3.1',
    releaseUrl: 'https://github.com/MustacheHax/MCM98_Launcher/releases',
    publishedAt: '2026-10-27T18:00:00Z',
    notes: 'Launcher update preview for the browser demo.',
    assetName: 'MCM98 Launcher-0.3.1-win-x64.exe',
    assetSize: 121_000_000,
    assetDownloadUrl:
      'https://github.com/MustacheHax/MCM98_Launcher/releases/download/v0.3.1/MCM98-Launcher-0.3.1-win-x64.exe',
    assetDigest: null,
    checkedAt: new Date().toISOString(),
    error: null,
    progress: {
      phase: 'idle',
      receivedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      message: null,
      error: null
    }
  }

  const snapshotTasks = (): InstallTask[] => [...tasks.values()].map(cloneTask)
  const emitTasks = (): void => {
    const snapshot = snapshotTasks()
    for (const listener of taskListeners) listener(snapshot)
  }
  const emitLibrary = (): void => {
    for (const listener of libraryListeners) listener()
  }
  const emitRunning = (): void => {
    const ids = [...running]
    for (const listener of runningListeners) listener(ids)
  }

  const clearTaskTimers = (taskId: string): void => {
    const timer = timers.get(taskId)
    if (!timer) return
    if (timer.interval !== null) window.clearInterval(timer.interval)
    for (const timeout of timer.timeouts) window.clearTimeout(timeout)
    timers.delete(taskId)
  }

  const finishInstall = (task: InstallTask, request: InstallRequest): void => {
    const existing = installed.find((item) => item.id === request.productId)
    const installPath = `${config.installRoot}\\${request.productId}`
    const executable = request.executable ?? 'Game.exe'
    const now = new Date().toISOString()
    const record: InstalledProduct = {
      id: request.productId,
      name: request.name,
      version: request.version,
      repo: request.repo,
      releaseUrl: request.releaseUrl,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      executable,
      args: request.args,
      installPath,
      appPath: `${installPath}\\app`,
      executablePath: `${installPath}\\app\\${executable.replace(/\//g, '\\')}`,
      sizeBytes: request.sizeBytes
    }
    installed = [...installed.filter((item) => item.id !== request.productId), record]
    clearTaskTimers(task.id)
    cancelled.delete(task.id)
    emitLibrary()
  }

  const beginSimulation = (task: InstallTask, request: InstallRequest): void => {
    if (cancelled.has(task.id)) return
    const timer = { interval: null as number | null, timeouts: [] as number[] }
    timers.set(task.id, timer)

    task.phase = 'downloading'
    task.message = `Downloading ${request.assetName}`
    task.startedAt = new Date().toISOString()
    emitTasks()

    const total = Math.max(request.sizeBytes, 1)
    const step = Math.max(total * 0.055, 512 * 1024)
    let received = 0

    timer.interval = window.setInterval(() => {
      if (cancelled.has(task.id)) return
      received = Math.min(total, received + step)
      task.receivedBytes = received
      task.speedBytesPerSec = step / 0.24
      emitTasks()

      if (received >= total && timer.interval !== null) {
        window.clearInterval(timer.interval)
        timer.interval = null
        task.phase = 'extracting'
        task.message = 'Extracting files'
        task.speedBytesPerSec = 0
        emitTasks()

        timer.timeouts.push(
          window.setTimeout(() => {
            if (cancelled.has(task.id)) return
            task.phase = 'finalizing'
            task.message = 'Finishing install'
            emitTasks()

            timer.timeouts.push(
              window.setTimeout(() => {
                if (cancelled.has(task.id)) return
                task.phase = 'done'
                task.message = 'Ready to play'
                task.receivedBytes = total
                task.totalBytes = total
                task.finishedAt = new Date().toISOString()
                emitTasks()
                finishInstall(task, request)
              }, 900)
            )
          }, 1_200)
        )
      }
    }, 240)
  }

  return {
    async getConfig() {
      await wait(60)
      return { ...config }
    },

    async saveConfig(patch) {
      const next: LauncherConfig = {
        ...config,
        backendUrl: patch.backendUrl?.trim() || config.backendUrl,
        installRoot: patch.installRoot?.trim() || config.installRoot,
        theme: patch.theme ?? config.theme,
        layout: patch.layout ?? config.layout,
        startView: patch.startView ?? config.startView,
        showSplash: patch.showSplash ?? config.showSplash,
        animations: patch.animations ?? config.animations,
        launchAtLogin: patch.launchAtLogin ?? config.launchAtLogin,
        autoCheckLauncher: patch.autoCheckLauncher ?? config.autoCheckLauncher,
        autoCheckProducts: patch.autoCheckProducts ?? config.autoCheckProducts,
        confirmUninstall: patch.confirmUninstall ?? config.confirmUninstall
      }
      try {
        void new URL(next.backendUrl)
      } catch {
        throw new Error('The relay URL must be a valid http:// or https:// address.')
      }
      config = next
      await wait(220)
      return { ...config }
    },

    async chooseInstallRoot() {
      await wait(120)
      return config.installRoot === DEMO_LIBRARY_ROOT ? 'D:\\MCM98 Library' : DEMO_LIBRARY_ROOT
    },

    async testBackend() {
      await wait(700)
      const health: HealthResponse = {
        ok: true,
        version: '0.3.0',
        timestamp: new Date().toISOString(),
        catalogProducts: buildCatalogProducts().length,
        githubAuthenticated: true
      }
      return health
    },

    async getAppInfo() {
      const info: AppInfo = {
        version: '0.3.0',
        platform: 'win32',
        arch: 'x64',
        isPackaged: false,
        installRoot: config.installRoot,
        dataRoot: 'C:\\Users\\Demo\\AppData\\Roaming\\MCM98 Launcher',
        logPath: 'C:\\Users\\Demo\\AppData\\Roaming\\MCM98 Launcher\\logs\\launcher.log'
      }
      return info
    },

    async fetchCatalog() {
      await wait(720)
      const response: CatalogResponse = {
        backendVersion: '0.3.0',
        generatedAt: new Date().toISOString(),
        platform: 'win32',
        products: buildCatalogProducts()
      }
      return response
    },

    async getLauncherUpdate() {
      return { ...launcherUpdate }
    },

    async checkLauncherUpdate() {
      launcherUpdate = { ...launcherUpdate, state: 'checking', checkedAt: null }
      for (const listener of updateListeners) listener({ ...launcherUpdate })
      await wait(650)
      launcherUpdate = {
        ...launcherUpdate,
        state: 'available',
        checkedAt: new Date().toISOString()
      }
      for (const listener of updateListeners) listener({ ...launcherUpdate })
      return { ...launcherUpdate }
    },

    async downloadLauncherUpdate() {
      if (launcherUpdate.progress.phase === 'ready') return { ...launcherUpdate }
      const total = launcherUpdate.assetSize ?? 1
      let received = 0

      launcherUpdate = {
        ...launcherUpdate,
        progress: {
          phase: 'downloading',
          receivedBytes: 0,
          totalBytes: total,
          speedBytesPerSec: 0,
          message: 'Downloading launcher update',
          error: null
        }
      }
      for (const listener of updateListeners) listener({ ...launcherUpdate })

      while (received < total) {
        await wait(180)
        received = Math.min(total, received + total * 0.09)
        launcherUpdate = {
          ...launcherUpdate,
          progress: {
            ...launcherUpdate.progress,
            receivedBytes: received,
            speedBytesPerSec: total * 0.5
          }
        }
        for (const listener of updateListeners) listener({ ...launcherUpdate })
      }

      launcherUpdate = {
        ...launcherUpdate,
        progress: {
          phase: 'ready',
          receivedBytes: total,
          totalBytes: total,
          speedBytesPerSec: 0,
          message: 'Ready to install',
          error: null
        }
      }
      for (const listener of updateListeners) listener({ ...launcherUpdate })
      return { ...launcherUpdate }
    },

    async installLauncherUpdate() {
      throw new Error(
        'The launcher restarts itself in the installed app. This browser preview cannot apply the update.'
      )
    },

    async listLibrary() {
      await wait(120)
      return installed.map((item) => ({ ...item }))
    },

    async startInstall(request) {
      if ([...tasks.values()].some((task) => task.productId === request.productId && !['done', 'error', 'cancelled'].includes(task.phase))) {
        throw new Error('That product is already downloading or installing.')
      }
      if (running.has(request.productId)) {
        throw new Error('Close the product before installing an update.')
      }
      await wait(180)

      sequence += 1
      const task: InstallTask = {
        id: `demo-task-${sequence}`,
        productId: request.productId,
        name: request.name,
        version: request.version,
        phase: 'queued',
        receivedBytes: 0,
        totalBytes: request.sizeBytes,
        speedBytesPerSec: 0,
        message: 'Queued',
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null
      }
      tasks.set(task.id, task)
      const timer = { interval: null as number | null, timeouts: [] as number[] }
      timers.set(task.id, timer)
      timer.timeouts.push(
        window.setTimeout(() => {
          if (!cancelled.has(task.id)) beginSimulation(task, request)
        }, 320)
      )
      emitTasks()
      return cloneTask(task)
    },

    async cancelInstall(taskId) {
      const task = tasks.get(taskId)
      if (!task || ['done', 'error', 'cancelled'].includes(task.phase)) return
      cancelled.add(taskId)
      clearTaskTimers(taskId)
      task.phase = 'cancelled'
      task.message = 'Cancelled'
      task.speedBytesPerSec = 0
      task.finishedAt = new Date().toISOString()
      emitTasks()
    },

    async getTasks() {
      return snapshotTasks()
    },

    async clearFinishedTasks() {
      for (const [id, task] of tasks) {
        if (['done', 'error', 'cancelled'].includes(task.phase)) tasks.delete(id)
      }
      emitTasks()
    },

    async uninstall(productId) {
      if (running.has(productId)) {
        throw new Error('Close the product before uninstalling it.')
      }
      await wait(260)
      installed = installed.filter((item) => item.id !== productId)
      emitLibrary()
    },

    async launch(productId) {
      const product = installed.find((item) => item.id === productId)
      if (!product) throw new Error('That product is not installed.')
      if (running.has(productId)) throw new Error('That product is already running.')
      running.add(productId)
      emitRunning()
      return { pid: 42000 + installed.indexOf(product) }
    },

    async getRunning() {
      return [...running]
    },

    async openPath() {
      await wait(50)
    },

    async openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    onTasks(callback) {
      taskListeners.add(callback)
      return () => taskListeners.delete(callback)
    },

    onLibraryChanged(callback) {
      libraryListeners.add(callback)
      return () => libraryListeners.delete(callback)
    },

    onRunningChanged(callback) {
      runningListeners.add(callback)
      return () => runningListeners.delete(callback)
    },

    onLauncherUpdate(callback) {
      updateListeners.add(callback)
      return () => updateListeners.delete(callback)
    }
  }
}
