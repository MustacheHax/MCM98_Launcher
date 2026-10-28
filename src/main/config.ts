import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join, parse, resolve } from 'node:path'
import type { LauncherConfig } from '@shared/types'
import type { Logger } from './logger'

const DEFAULT_BACKEND =
  (import.meta.env.MAIN_VITE_BACKEND_URL ?? '').trim() || 'http://localhost:8790'

interface StoredConfig {
  backendUrl?: unknown
  installRoot?: unknown
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
      installRoot: join(this.dataRoot, 'Library')
    }
    this.current = this.load(defaults)
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

      const config: LauncherConfig = {
        backendUrl: backendUrl ?? defaults.backendUrl,
        installRoot: installRoot ?? defaults.installRoot
      }
      if (!backendUrl || !installRoot) {
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
          : normalizeInstallRoot(patch.installRoot)
    }

    mkdirSync(next.installRoot, { recursive: true })
    mkdirSync(this.dataRoot, { recursive: true })
    const tempPath = `${this.configPath}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tempPath, this.configPath)
    this.current = next
    this.log.info('Launcher settings updated.', {
      backendUrl: next.backendUrl,
      installRoot: next.installRoot
    })
    return this.get()
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
