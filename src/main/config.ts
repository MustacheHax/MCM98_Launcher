import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join, parse, resolve } from 'node:path'
import { DEFAULT_TEXT_SIZE, isTextSize } from '@shared/textSize'
import { DEFAULT_THEME, isThemeId } from '@shared/themes'
import type {
  LaunchView,
  LauncherConfig,
  LauncherLayout,
  WindowBounds
} from '@shared/types'
import type { Logger } from './logger'

/** Relay used by packaged builds when nothing else is configured. */
const HOSTED_BACKEND = 'https://mcm98-launcher.onrender.com'
/** Local relay started by `npm run dev`; never the default for users. */
const LOCAL_BACKEND = 'http://localhost:8790'
/** Build-time override, for a self-hosted relay. */
const BUILD_BACKEND = (import.meta.env.MAIN_VITE_BACKEND_URL ?? '').trim()

const DEFAULT_BACKEND = BUILD_BACKEND || (app.isPackaged ? HOSTED_BACKEND : LOCAL_BACKEND)

const LAYOUTS: LauncherLayout[] = ['compact', 'full']
const START_VIEWS: LaunchView[] = ['library', 'catalog', 'downloads']
const SETTING_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isLauncherLayout(value: unknown): value is LauncherLayout {
  return typeof value === 'string' && LAYOUTS.includes(value as LauncherLayout)
}

export function isLaunchView(value: unknown): value is LaunchView {
  return typeof value === 'string' && START_VIEWS.includes(value as LaunchView)
}

interface StoredConfig {
  backendUrl?: unknown
  installRoot?: unknown
  theme?: unknown
  textSize?: unknown
  layout?: unknown
  startView?: unknown
  showSplash?: unknown
  animations?: unknown
  launchAtLogin?: unknown
  autoCheckLauncher?: unknown
  autoCheckProducts?: unknown
  confirmUninstall?: unknown
  skippedUpdates?: unknown
  windowBounds?: unknown
}

function storedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Skipped release versions are keyed by product id, so they survive updates. */
function sanitizeSkippedUpdates(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [id, version] of Object.entries(value as Record<string, unknown>)) {
    if (!SETTING_ID.test(id)) continue
    if (typeof version !== 'string' || !version.trim()) continue
    result[id] = version.trim().slice(0, 80)
  }
  return result
}

/** Saved window bounds; anything absurd is dropped so the window stays reachable. */
function sanitizeWindowBounds(value: unknown): Partial<Record<LauncherLayout, WindowBounds>> {
  if (!value || typeof value !== 'object') return {}
  const result: Partial<Record<LauncherLayout, WindowBounds>> = {}
  for (const layout of LAYOUTS) {
    const raw = (value as Record<string, unknown>)[layout]
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const x = Number(item.x)
    const y = Number(item.y)
    const width = Number(item.width)
    const height = Number(item.height)
    if (![x, y, width, height].every((number) => Number.isFinite(number))) continue
    if (width < 240 || height < 240) continue
    result[layout] = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    }
  }
  return result
}

export class ConfigStore {
  readonly dataRoot: string
  readonly configPath: string
  readonly logPath: string
  private current: LauncherConfig

  constructor(private readonly log: Logger) {
    this.dataRoot = app.getPath('userData')
    this.configPath = join(this.dataRoot, 'config.json')
    this.logPath = join(this.dataRoot, 'logs', 'launcher.log')

    const defaults: LauncherConfig = {
      backendUrl: normalizeBackendUrl(DEFAULT_BACKEND),
      installRoot: join(this.dataRoot, 'Library'),
      theme: DEFAULT_THEME,
      textSize: DEFAULT_TEXT_SIZE,
      layout: 'compact',
      startView: 'library',
      showSplash: true,
      animations: true,
      launchAtLogin: false,
      autoCheckLauncher: true,
      autoCheckProducts: true,
      confirmUninstall: true,
      skippedUpdates: {},
      windowBounds: {}
    }
    this.current = this.load(defaults)
    this.enforceBackend(defaults.backendUrl)
  }

  /**
   * The relay is chosen by the build (`MAIN_VITE_BACKEND_URL`, otherwise the
   * hosted service, otherwise the local one in development) rather than by the
   * user, so a stored address from an older build is replaced and persisted.
   * That keeps upgrades working after the hosted relay moves.
   */
  private enforceBackend(fallback: string): void {
    const previous = this.current.backendUrl
    if (previous === fallback) return

    this.current = { ...this.current, backendUrl: fallback }
    this.log.info(`Relay address set to ${fallback} (stored value was ${previous}).`)
    try {
      this.persist(this.current)
    } catch (error) {
      this.log.warn('Could not save the relay address; using it for this session only.', error)
    }
  }

  private load(defaults: LauncherConfig): LauncherConfig {
    if (!existsSync(this.configPath)) return defaults

    try {
      const stored = JSON.parse(readFileSync(this.configPath, 'utf8')) as StoredConfig
      const backendUrl =
        typeof stored.backendUrl === 'string'
          ? tryNormalizeBackendUrl(stored.backendUrl)
          : null
      const installRoot =
        typeof stored.installRoot === 'string' ? tryNormalizeInstallRoot(stored.installRoot) : null
      const theme = isThemeId(stored.theme) ? stored.theme : defaults.theme
      const textSize = isTextSize(stored.textSize) ? stored.textSize : defaults.textSize

      const config: LauncherConfig = {
        backendUrl: backendUrl ?? defaults.backendUrl,
        installRoot: installRoot ?? defaults.installRoot,
        theme,
        textSize,
        layout: isLauncherLayout(stored.layout) ? stored.layout : defaults.layout,
        startView: isLaunchView(stored.startView) ? stored.startView : defaults.startView,
        showSplash: storedBoolean(stored.showSplash, defaults.showSplash),
        animations: storedBoolean(stored.animations, defaults.animations),
        launchAtLogin: storedBoolean(stored.launchAtLogin, defaults.launchAtLogin),
        autoCheckLauncher: storedBoolean(stored.autoCheckLauncher, defaults.autoCheckLauncher),
        autoCheckProducts: storedBoolean(stored.autoCheckProducts, defaults.autoCheckProducts),
        confirmUninstall: storedBoolean(stored.confirmUninstall, defaults.confirmUninstall),
        skippedUpdates: sanitizeSkippedUpdates(stored.skippedUpdates),
        windowBounds: sanitizeWindowBounds(stored.windowBounds)
      }
      if (
        !backendUrl ||
        !installRoot ||
        (stored.theme !== undefined && !isThemeId(stored.theme)) ||
        (stored.textSize !== undefined && !isTextSize(stored.textSize))
      ) {
        this.log.warn('Some saved launcher settings were invalid; defaults were applied.')
      }
      return config
    } catch (error) {
      this.log.warn('Could not read launcher config; starting with defaults.', error)
      try {
        renameSync(this.configPath, `${this.configPath}.invalid-${Date.now()}`)
      } catch {
        // Ignore backup failure.
      }
      return defaults
    }
  }

  get(): LauncherConfig {
    return { ...this.current }
  }

  update(patch: Partial<LauncherConfig>): LauncherConfig {
    const next: LauncherConfig = {
      backendUrl:
        patch.backendUrl === undefined
          ? this.current.backendUrl
          : normalizeBackendUrl(patch.backendUrl),
      installRoot:
        patch.installRoot === undefined
          ? this.current.installRoot
          : normalizeInstallRoot(patch.installRoot),
      theme: isThemeId(patch.theme) ? patch.theme : this.current.theme,
      textSize: isTextSize(patch.textSize) ? patch.textSize : this.current.textSize,
      layout: isLauncherLayout(patch.layout) ? patch.layout : this.current.layout,
      startView: isLaunchView(patch.startView) ? patch.startView : this.current.startView,
      showSplash:
        typeof patch.showSplash === 'boolean' ? patch.showSplash : this.current.showSplash,
      animations:
        typeof patch.animations === 'boolean' ? patch.animations : this.current.animations,
      launchAtLogin:
        typeof patch.launchAtLogin === 'boolean'
          ? patch.launchAtLogin
          : this.current.launchAtLogin,
      autoCheckLauncher:
        typeof patch.autoCheckLauncher === 'boolean'
          ? patch.autoCheckLauncher
          : this.current.autoCheckLauncher,
      autoCheckProducts:
        typeof patch.autoCheckProducts === 'boolean'
          ? patch.autoCheckProducts
          : this.current.autoCheckProducts,
      confirmUninstall:
        typeof patch.confirmUninstall === 'boolean'
          ? patch.confirmUninstall
          : this.current.confirmUninstall,
      skippedUpdates:
        patch.skippedUpdates === undefined
          ? this.current.skippedUpdates
          : sanitizeSkippedUpdates(patch.skippedUpdates),
      windowBounds:
        patch.windowBounds === undefined
          ? this.current.windowBounds
          : sanitizeWindowBounds(patch.windowBounds)
    }

    this.persist(next)
    this.current = next
    this.log.info('Launcher settings updated.', {
      backendUrl: next.backendUrl,
      installRoot: next.installRoot,
      theme: next.theme,
      textSize: next.textSize,
      layout: next.layout
    })
    return this.get()
  }

  private persist(config: LauncherConfig): void {
    // The installer creates the library on demand. A missing or disconnected
    // drive must not stop unrelated settings from being saved.
    try {
      mkdirSync(config.installRoot, { recursive: true })
    } catch (error) {
      this.log.warn(`Could not create the install folder ${config.installRoot}.`, error)
    }
    mkdirSync(this.dataRoot, { recursive: true })
    const tempPath = `${this.configPath}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(tempPath, this.configPath)
  }
}

function tryNormalizeBackendUrl(value: string): string | null {
  try {
    return normalizeBackendUrl(value)
  } catch {
    return null
  }
}

function tryNormalizeInstallRoot(value: string): string | null {
  try {
    return normalizeInstallRoot(value)
  } catch {
    return null
  }
}

export function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('The relay URL cannot be empty.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('The relay URL must be a valid http:// or https:// address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The relay URL must start with http:// or https://.')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

export function normalizeInstallRoot(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('The install folder cannot be empty.')
  const resolved = resolve(trimmed)
  if (parse(resolved).root === resolved) {
    throw new Error('Choose a folder inside a drive, not the drive root itself.')
  }
  return resolved
}
