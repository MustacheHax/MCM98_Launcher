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
import type { LaunchView, LauncherConfig, LauncherLayout } from '@shared/types'
import type { Logger } from './logger'

/** Relay used by packaged builds when nothing else is configured. */
const HOSTED_BACKEND = 'https://mcm98-launcher.onrender.com'
/** Local relay started by `npm run dev`; never the default for users. */
const LOCAL_BACKEND = 'http://localhost:8790'
/** Build-time override, for a self-hosted relay. */
const BUILD_BACKEND = (import.meta.env.MAIN_VITE_BACKEND_URL ?? '').trim()

const DEFAULT_BACKEND = BUILD_BACKEND || (app.isPackaged ? HOSTED_BACKEND : LOCAL_BACKEND)

/**
 * Addresses written by builds that shipped without a production relay. On a
 * user's machine nothing answers on those ports, so packaged installs are
 * moved to the real default once. A URL typed in Settings is never rewritten.
 */
const LEGACY_DEFAULT_BACKENDS = new Set([
  'http://localhost:8790',
  'http://localhost',
  'http://127.0.0.1:8790'
])

const LAYOUTS: LauncherLayout[] = ['compact', 'full']
const START_VIEWS: LaunchView[] = ['library', 'catalog', 'downloads']

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
}

function storedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
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
      confirmUninstall: true
    }
    this.current = this.load(defaults)
    this.migrateLegacyBackend(defaults.backendUrl)
  }

  /**
   * Earlier builds stored the development relay. A packaged launcher should
   * talk to the hosted relay instead, so upgrade that one value and persist it.
   */
  private migrateLegacyBackend(fallback: string): void {
    const previous = this.current.backendUrl
    if (!app.isPackaged || previous === fallback || !LEGACY_DEFAULT_BACKENDS.has(previous)) {
      return
    }

    this.current = { ...this.current, backendUrl: fallback }
    try {
      this.persist(this.current)
      this.log.info(`Relay URL upgraded from ${previous} to ${fallback}.`)
    } catch (error) {
      this.log.warn('Could not save the upgraded relay URL; using it for this session only.', error)
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
        confirmUninstall: storedBoolean(stored.confirmUninstall, defaults.confirmUninstall)
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
          : this.current.confirmUninstall
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
    mkdirSync(config.installRoot, { recursive: true })
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
