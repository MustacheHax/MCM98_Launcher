import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  LauncherReleaseInfo,
  LauncherUpdateInfo,
  LauncherUpdateProgress,
  LauncherUpdateState,
  Platform
} from '@shared/types'
import { isUpdateAvailable, isVersionLike, normalizeVersion, versionFromText } from '@shared/version'
import { extractArchive } from './archive'
import type { ConfigStore } from './config'
import { detectExecutable } from './detect'
import { AbortError, downloadFile } from './download'
import { ensureDir, removePath } from './fs-utils'
import type { Logger } from './logger'
import { fetchLauncherRelease } from './relay'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const ARCHIVE_ASSET = /\.(zip|tar\.gz|tgz)$/i

function idleProgress(): LauncherUpdateProgress {
  return {
    phase: 'idle',
    receivedBytes: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
    message: null,
    error: null
  }
}

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
    assetDownloadUrl: null,
    assetDigest: null,
    checkedAt: null,
    error: null,
    progress: idleProgress()
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/i, '').trim().slice(0, 500)
}

function safeAssetName(name: string | null): string {
  const cleaned = basename(name ?? 'launcher-update')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
  return cleaned || 'launcher-update'
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Builds a command line escaped for a VBScript string literal. */
function vbsCommandLine(command: string, args: string[]): string {
  return [command, ...args]
    .map(quoteWindowsArgument)
    .join(' ')
    .replace(/"/g, '""')
}

/**
 * Checks the launcher's own GitHub releases through the relay, and applies a
 * downloaded update in place. Applying an update hands the replacement work to
 * a short-lived helper after this process exits, then relaunches the app.
 */
export class LauncherUpdater {
  private info: LauncherUpdateInfo
  private checkInFlight: Promise<LauncherUpdateInfo> | null = null
  private downloadInFlight: Promise<LauncherUpdateInfo> | null = null
  private downloadController: AbortController | null = null
  private downloadedPath: string | null = null
  private installing = false
  private interval: NodeJS.Timeout | null = null
  private lastProgressEmit = 0

  constructor(
    private readonly config: ConfigStore,
    private readonly platform: Platform,
    private readonly log: Logger,
    private readonly onChange: (info: LauncherUpdateInfo) => void
  ) {
    this.info = initialInfo(app.getVersion())
  }

  getInfo(): LauncherUpdateInfo {
    return { ...this.info, progress: { ...this.info.progress } }
  }

  /** Enables or disables the automatic release poll without touching a
   * download that is already in flight. Manual checks always remain available. */
  setAutoCheck(enabled: boolean): void {
    if (enabled) {
      if (!this.interval) {
        this.interval = setInterval(() => {
          void this.check()
        }, CHECK_INTERVAL_MS)
        this.interval.unref()
      }
      void this.check()
      return
    }

    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  start(): void {
    this.setAutoCheck(true)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.downloadController?.abort()
  }

  async check(): Promise<LauncherUpdateInfo> {
    if (this.checkInFlight) return this.checkInFlight
    if (
      this.info.progress.phase === 'downloading' ||
      this.info.progress.phase === 'verifying' ||
      this.info.progress.phase === 'installing'
    ) {
      return this.getInfo()
    }

    const currentVersion = app.getVersion()
    this.patch({ state: 'checking', currentVersion, error: null })

    this.checkInFlight = this.runCheck(currentVersion).finally(() => {
      this.checkInFlight = null
    })
    return this.checkInFlight
  }

  async download(): Promise<LauncherUpdateInfo> {
    if (this.downloadInFlight) return this.downloadInFlight
    if (this.info.progress.phase === 'ready' && this.downloadedPath) return this.getInfo()
    if (this.info.state !== 'available') {
      throw new Error('No launcher update is available to download.')
    }
    if (!this.info.assetDownloadUrl) {
      throw new Error('The relay did not provide a download for this launcher release.')
    }

    const url = this.info.assetDownloadUrl
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Unsupported download protocol.')
      }
    } catch {
      throw new Error('The relay returned an invalid launcher download URL.')
    }

    const version = this.info.latestVersion ?? 'latest'
    const assetName = safeAssetName(this.info.assetName)
    const totalBytes = this.info.assetSize ?? 0
    const digest = this.info.assetDigest
    const destination = join(
      this.config.dataRoot,
      'updates',
      `launcher-${version.replace(/[^A-Za-z0-9._-]/g, '_')}-${assetName}`
    )

    this.patch({
      progress: {
        phase: 'downloading',
        receivedBytes: 0,
        totalBytes,
        speedBytesPerSec: 0,
        message: `Downloading ${assetName}`,
        error: null
      }
    })

    const controller = new AbortController()
    this.downloadController = controller

    this.downloadInFlight = this.runDownload({
      url,
      destination,
      assetName,
      totalBytes,
      digest,
      signal: controller.signal
    }).finally(() => {
      this.downloadInFlight = null
      this.downloadController = null
    })
    return this.downloadInFlight
  }

  async install(): Promise<void> {
    if (this.installing) return
    if (!this.downloadedPath || !existsSync(this.downloadedPath)) {
      throw new Error('Download the launcher update before installing it.')
    }
    if (!app.isPackaged) {
      throw new Error(
        'In-app updates are only available in the installed launcher. Use the release page while running from source.'
      )
    }

    const assetName = this.info.assetName ?? basename(this.downloadedPath)
    this.installing = true
    this.patch({
      progress: {
        ...this.info.progress,
        phase: 'installing',
        message: 'Preparing to restart…',
        error: null
      }
    })

    try {
      await this.applyUpdate(this.downloadedPath, assetName)
      this.log.info(`Applying launcher update to ${this.info.latestVersion ?? 'the newest release'}.`)
    } catch (error) {
      this.installing = false
      const message = errorMessage(error)
      this.patch({
        progress: {
          ...this.info.progress,
          phase: 'error',
          message,
          error: message
        }
      })
      this.log.warn(`Could not apply the launcher update: ${message}`)
      throw new Error(message)
    }

    // Give the renderer a moment to show the installing state, then hand over
    // to the detached helper that waits for this process to exit.
    setTimeout(() => app.quit(), 700)
  }

  private async runCheck(currentVersion: string): Promise<LauncherUpdateInfo> {
    try {
      const response = await fetchLauncherRelease(this.config.get(), this.platform, this.log)
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

      // Relays can be older than this app, and some releases use a rolling tag
      // such as "newest". Derive a comparable version from the release title or
      // asset name rather than treating the tag itself as a version.
      const releaseVersion = isVersionLike(release.version)
        ? normalizeVersion(release.version)
        : (versionFromText(release.name) ?? versionFromText(release.assetName))

      if (!releaseVersion) {
        this.log.warn(
          `Launcher release ${release.tag} has no comparable version; skipping the update check.`
        )
        return this.patch({
          state: 'unavailable',
          currentVersion,
          latestVersion: null,
          ...releaseFields(release),
          checkedAt: new Date().toISOString(),
          error:
            'The newest launcher release does not include a version number. Publish a release titled or packaged with a version such as 0.3.0.'
        })
      }

      const available = isUpdateAvailable(currentVersion, releaseVersion)
      const state: LauncherUpdateState = available ? 'available' : 'current'
      const sameRelease = this.info.latestVersion === releaseVersion
      const progress = sameRelease ? this.info.progress : idleProgress()

      if (!sameRelease) this.downloadedPath = null

      this.log.info(
        `Launcher update check: current ${currentVersion}, latest ${releaseVersion} (${state}).`
      )

      return this.patch({
        state,
        currentVersion,
        latestVersion: releaseVersion,
        ...releaseFields(release),
        checkedAt: new Date().toISOString(),
        error: null,
        progress
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

  private async runDownload(input: {
    url: string
    destination: string
    assetName: string
    totalBytes: number
    digest: string | null
    signal: AbortSignal
  }): Promise<LauncherUpdateInfo> {
    let sample: { at: number; bytes: number } | null = null

    try {
      await mkdir(dirname(input.destination), { recursive: true })
      await removePath(input.destination).catch(() => undefined)

      this.log.info(`Downloading launcher update ${input.assetName}.`)
      const result = await downloadFile({
        url: input.url,
        destination: input.destination,
        expectedBytes: input.totalBytes,
        digest: input.digest,
        signal: input.signal,
        onProgress: (received, total) => {
          const now = Date.now()
          const progress = { ...this.info.progress }
          progress.phase = 'downloading'
          progress.receivedBytes = received
          if (total > 0) progress.totalBytes = total

          if (sample) {
            const elapsed = (now - sample.at) / 1000
            if (elapsed >= 0.35) {
              const instant = Math.max(0, (received - sample.bytes) / elapsed)
              progress.speedBytesPerSec =
                progress.speedBytesPerSec > 0
                  ? progress.speedBytesPerSec * 0.65 + instant * 0.35
                  : instant
              sample = { at: now, bytes: received }
            }
          } else {
            sample = { at: now, bytes: received }
          }

          if (now - this.lastProgressEmit >= 180) {
            this.lastProgressEmit = now
            this.patch({ progress })
          } else {
            this.info = { ...this.info, progress }
          }
        },
        onDownloaded: () => {
          this.patch({
            progress: {
              ...this.info.progress,
              phase: 'verifying',
              speedBytesPerSec: 0,
              message: 'Verifying download'
            }
          })
        }
      })

      if (input.signal.aborted) throw new AbortError()

      this.downloadedPath = input.destination
      return this.patch({
        progress: {
          phase: 'ready',
          receivedBytes: result.bytes,
          totalBytes: result.bytes,
          speedBytesPerSec: 0,
          message: 'Ready to install',
          error: null
        }
      })
    } catch (error) {
      const aborted = input.signal.aborted || error instanceof AbortError
      const message = aborted ? 'Download cancelled.' : errorMessage(error)
      this.log.warn(`Launcher update download failed: ${message}`)
      if (!aborted) await removePath(input.destination).catch(() => undefined)
      return this.patch({
        progress: {
          phase: 'error',
          receivedBytes: 0,
          totalBytes: input.totalBytes,
          speedBytesPerSec: 0,
          message,
          error: message
        }
      })
    }
  }

  private async applyUpdate(filePath: string, assetName: string): Promise<void> {
    if (this.platform === 'win32') {
      if (/\.exe$/i.test(assetName)) {
        await this.runWindowsInstaller(filePath)
        return
      }
      if (ARCHIVE_ASSET.test(assetName)) {
        await this.replaceFromWindowsArchive(filePath, assetName)
        return
      }
      throw new Error('This launcher build is not a Windows installer or portable archive.')
    }

    if (this.platform === 'linux') {
      if (/\.appimage$/i.test(assetName)) {
        await this.replaceLinuxAppImage(filePath)
        return
      }
      if (ARCHIVE_ASSET.test(assetName)) {
        await this.replaceFromLinuxArchive(filePath, assetName)
        return
      }
      throw new Error('This launcher build is not a Linux AppImage or archive.')
    }

    // macOS launcher updates stay a Finder action for now: replacing a running
    // .app bundle is not reliable without a signed helper.
    const opened = await shell.openPath(filePath)
    if (opened) throw new Error(opened)
    throw new Error(
      'The macOS build was opened in Finder. Drag the launcher into Applications to finish updating.'
    )
  }

  private async runWindowsInstaller(installerPath: string): Promise<void> {
    const exePath = process.execPath
    const scriptPath = await this.writeHelperScript(
      'install.ps1',
      [
        `$ErrorActionPreference = 'SilentlyContinue'`,
        `try { Wait-Process -Id ${process.pid} -Timeout 45 } catch {}`,
        `Start-Sleep -Milliseconds 1200`,
        `$installer = Start-Process -FilePath ${psQuote(installerPath)} -ArgumentList '/S' -PassThru`,
        `if ($installer) { $installer.WaitForExit() }`,
        `Start-Sleep -Milliseconds 1500`,
        `if (Test-Path ${psQuote(exePath)}) { Start-Process -FilePath ${psQuote(exePath)} }`
      ].join('\r\n')
    )

    await this.spawnDetached(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath
      ],
      this.config.dataRoot
    )
  }

  private async replaceFromWindowsArchive(filePath: string, assetName: string): Promise<void> {
    const staging = join(this.config.dataRoot, 'updates', `staging-${Date.now()}`)
    await ensureDir(staging)

    try {
      await extractArchive(filePath, staging, assetName, {
        signal: new AbortController().signal,
        logger: this.log,
        onEntry: () => undefined
      })

      const detection = await detectExecutable(
        staging,
        'win32',
        app.getName(),
        null,
        this.log
      )
      if (!detection.executable) {
        throw new Error('The downloaded archive does not contain a launchable launcher build.')
      }

      const sourceRoot = dirname(join(staging, detection.executable))
      const targetRoot = dirname(process.execPath)
      const targetExe = join(targetRoot, basename(process.execPath))

      const scriptPath = await this.writeHelperScript(
        'replace.ps1',
        [
          `$ErrorActionPreference = 'SilentlyContinue'`,
          `try { Wait-Process -Id ${process.pid} -Timeout 45 } catch {}`,
          `Start-Sleep -Milliseconds 1200`,
          `robocopy ${psQuote(sourceRoot)} ${psQuote(targetRoot)} /E /IS /IT /R:3 /W:1 /NFL /NDL /NJH /NJS /NC /NS | Out-Null`,
          `Start-Sleep -Milliseconds 900`,
          `Remove-Item -LiteralPath ${psQuote(staging)} -Recurse -Force`,
          `if (Test-Path ${psQuote(targetExe)}) { Start-Process -FilePath ${psQuote(targetExe)} }`
        ].join('\r\n')
      )

      await this.spawnDetached(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          scriptPath
        ],
        this.config.dataRoot
      )
    } catch (error) {
      // The helper deletes staging after a successful copy. A failure before
      // it starts must not leave a full extracted build behind.
      await removePath(staging).catch(() => undefined)
      throw error
    }
  }

  private async replaceLinuxAppImage(filePath: string): Promise<void> {
    // In an AppImage, process.execPath points at the mounted runtime; APPIMAGE
    // is the single file the user actually launched.
    const target = process.env.APPIMAGE?.trim() || process.execPath
    const scriptPath = await this.writeHelperScript(
      'replace.sh',
      [
        '#!/bin/sh',
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        `cp ${shQuote(filePath)} ${shQuote(target)}`,
        `chmod +x ${shQuote(target)}`,
        `"${target}" >/dev/null 2>&1 &`
      ].join('\n')
    )

    await this.spawnDetached('sh', [scriptPath], this.config.dataRoot)
  }

  private async replaceFromLinuxArchive(filePath: string, assetName: string): Promise<void> {
    const staging = join(this.config.dataRoot, 'updates', `staging-${Date.now()}`)
    await ensureDir(staging)

    try {
      await extractArchive(filePath, staging, assetName, {
        signal: new AbortController().signal,
        logger: this.log,
        onEntry: () => undefined
      })

      const detection = await detectExecutable(staging, 'linux', app.getName(), null, this.log)
      if (!detection.executable) {
        throw new Error('The downloaded archive does not contain a launchable launcher build.')
      }

      const sourceRoot = dirname(join(staging, detection.executable))
      const targetRoot = dirname(process.execPath)
      const targetExe = join(targetRoot, basename(process.execPath))
      const scriptPath = await this.writeHelperScript(
        'replace.sh',
        [
          '#!/bin/sh',
          `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
          `cp -a ${shQuote(`${sourceRoot}/.`)} ${shQuote(targetRoot)}/`,
          `chmod +x ${shQuote(targetExe)}`,
          `rm -rf ${shQuote(staging)}`,
          `"${targetExe}" >/dev/null 2>&1 &`
        ].join('\n')
      )

      await this.spawnDetached('sh', [scriptPath], this.config.dataRoot)
    } catch (error) {
      await removePath(staging).catch(() => undefined)
      throw error
    }
  }

  private async writeHelperScript(name: string, contents: string): Promise<string> {
    const helperDir = join(this.config.dataRoot, 'updates')
    await mkdir(helperDir, { recursive: true })
    const scriptPath = join(helperDir, `mcm98-${Date.now()}-${name}`)
    await writeFile(scriptPath, contents, 'utf8')
    if (this.platform === 'linux') await chmod(scriptPath, 0o755)
    return scriptPath
  }

  /**
   * Starts a helper that has to outlive this process. On Windows a detached
   * console child dies with the launcher and `detached: true` stops PowerShell
   * from running the script at all, so wscript launches the command hidden
   * instead. Other platforms only need a detached spawn.
   */
  private async spawnDetached(
    command: string,
    args: string[],
    cwd: string
  ): Promise<void> {
    if (this.platform === 'win32') {
      await this.spawnWindowsDetached(command, args, cwd)
      return
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: 'ignore'
      })
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
      child.once('error', reject)
    })
  }

  private async spawnWindowsDetached(
    command: string,
    args: string[],
    cwd: string
  ): Promise<void> {
    const scriptPath = await this.writeHelperScript(
      'run.vbs',
      [
        'Set sh = CreateObject("WScript.Shell")',
        `sh.Run "${vbsCommandLine(command, args)}", 0, False`
      ].join('\r\n')
    )

    await new Promise<void>((resolve, reject) => {
      const child = spawn('wscript.exe', ['//nologo', '//B', scriptPath], {
        cwd,
        stdio: 'ignore',
        windowsHide: true
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`The update helper could not be started (wscript exit ${code}).`))
      })
    })
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
  | 'releaseName'
  | 'releaseUrl'
  | 'publishedAt'
  | 'notes'
  | 'assetName'
  | 'assetSize'
  | 'assetDownloadUrl'
  | 'assetDigest'
> {
  return {
    releaseName: release.name,
    releaseUrl: release.url,
    publishedAt: release.publishedAt,
    notes: release.notes,
    assetName: release.assetName,
    assetSize: release.assetSize,
    assetDownloadUrl: release.assetDownloadUrl,
    assetDigest: release.assetDigest
  }
}
