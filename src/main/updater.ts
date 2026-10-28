import { app } from 'electron'
import type {
  LauncherReleaseInfo,
  LauncherUpdateInfo,
  LauncherUpdateState,
  Platform
} from '@shared/types'
import { isUpdateAvailable } from '@shared/version'
import type { ConfigStore } from './config'
import type { Logger } from './logger'
import { fetchLauncherRelease } from './relay'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function initialInfo(currentVersion: string): LauncherUpdateInfo {
  return {
    state: 'idle',
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseUrl: null,
    publishedAt: null,
    notes: null,
    assetName: null,
    assetSize: null,
    checkedAt: null,
    error: null
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/i, '').trim().slice(0, 500)
}

/**
 * Checks the launcher's own GitHub releases through the relay. This is
 * detection only: opening the release page and installing the new build stays
 * an explicit user action, so an unsigned Windows build never replaces itself
 * silently.
 */
export class LauncherUpdater {
  private info: LauncherUpdateInfo
  private checkInFlight: Promise<LauncherUpdateInfo> | null = null
  private interval: NodeJS.Timeout | null = null

  constructor(
    private readonly config: ConfigStore,
    private readonly platform: Platform,
    private readonly log: Logger,
    private readonly onChange: (info: LauncherUpdateInfo) => void
  ) {
    this.info = initialInfo(app.getVersion())
  }

  getInfo(): LauncherUpdateInfo {
    return { ...this.info }
  }

  start(): void {
    if (this.interval) return
    void this.check()
    this.interval = setInterval(() => {
      void this.check()
    }, CHECK_INTERVAL_MS)
    this.interval.unref()
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async check(): Promise<LauncherUpdateInfo> {
    if (this.checkInFlight) return this.checkInFlight

    const currentVersion = app.getVersion()
    this.patch({ state: 'checking', currentVersion, error: null })

    this.checkInFlight = this.runCheck(currentVersion).finally(() => {
      this.checkInFlight = null
    })
    return this.checkInFlight
  }

  private async runCheck(currentVersion: string): Promise<LauncherUpdateInfo> {
    try {
      const response = await fetchLauncherRelease(
        this.config.get(),
        this.platform,
        this.log
      )
      const release = response.release

      if (!release) {
        return this.patch({
          state: 'unavailable',
          currentVersion,
          latestVersion: null,
          error: response.error,
          checkedAt: new Date().toISOString()
        })
      }

      const available = isUpdateAvailable(currentVersion, release.version)
      const state: LauncherUpdateState = available ? 'available' : 'current'

      this.log.info(
        `Launcher update check: current ${currentVersion}, latest ${release.version} (${state}).`
      )

      return this.patch({
        state,
        currentVersion,
        latestVersion: release.version,
        ...releaseFields(release),
        checkedAt: new Date().toISOString(),
        error: null
      })
    } catch (error) {
      const message = errorMessage(error)
      this.log.warn(`Launcher update check failed: ${message}`)
      return this.patch({
        state: 'error',
        currentVersion,
        latestVersion: null,
        error: message,
        checkedAt: new Date().toISOString()
      })
    }
  }

  private patch(patch: Partial<LauncherUpdateInfo>): LauncherUpdateInfo {
    this.info = { ...this.info, ...patch }
    const snapshot = this.getInfo()
    this.onChange(snapshot)
    return snapshot
  }
}

function releaseFields(
  release: LauncherReleaseInfo
): Pick<
  LauncherUpdateInfo,
  'releaseName' | 'releaseUrl' | 'publishedAt' | 'notes' | 'assetName' | 'assetSize'
> {
  return {
    releaseName: release.name,
    releaseUrl: release.url,
    publishedAt: release.publishedAt,
    notes: release.notes,
    assetName: release.assetName,
    assetSize: release.assetSize
  }
}
