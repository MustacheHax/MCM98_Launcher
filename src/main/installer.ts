import { existsSync } from 'node:fs'
import { readdir, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  InstallPhase,
  InstallRequest,
  InstallTask,
  Platform
} from '@shared/types'
import { extractArchive } from './archive'
import type { ConfigStore } from './config'
import { AbortError, downloadFile } from './download'
import { detectExecutable } from './detect'
import { directorySize, ensureDir, removePath, safeRelativePath } from './fs-utils'
import type { LaunchService } from './launch'
import {
  assertProductId,
  productDirectory,
  readManifest,
  writeManifest,
  type InstallManifest,
  type LibraryService
} from './library'
import type { Logger } from './logger'

const MAX_CONCURRENT_INSTALLS = 2
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024
const SUPPORTED_ARCHIVE = /\.(zip|tar\.gz|tgz)$/i
const URL_HOST_ALLOWLIST = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com'
])

interface TaskRecord {
  task: InstallTask
  request: InstallRequest
  controller: AbortController | null
  active: boolean
  lastEmitAt: number
  sample: { at: number; bytes: number } | null
}

export interface InstallManagerOptions {
  config: ConfigStore
  library: LibraryService
  launch: LaunchService
  logger: Logger
  emitTasks: (tasks: InstallTask[]) => void
  emitLibraryChanged: () => void
}

export class InstallManager {
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly platform: Platform
  private lastQueueEmit = 0

  constructor(private readonly options: InstallManagerOptions) {
    this.platform = process.platform as Platform
  }

  private get log(): Logger {
    return this.options.logger
  }

  startInstall(raw: InstallRequest): InstallTask {
    const request = this.validateRequest(raw)
    if (this.hasActiveProduct(request.productId)) {
      throw new Error('That product is already downloading or installing.')
    }
    if (this.options.launch.isRunning(request.productId)) {
      throw new Error('Close the product before installing an update.')
    }

    const task: InstallTask = {
      id: crypto.randomUUID(),
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

    this.tasks.set(task.id, {
      task,
      request,
      controller: null,
      active: false,
      lastEmitAt: 0,
      sample: null
    })
    this.log.info(`Queued install for ${request.productId} ${request.version}.`)
    this.broadcast(true)
    this.pump()
    return { ...task }
  }

  getTasks(): InstallTask[] {
    return [...this.tasks.values()].map((record) => ({ ...record.task }))
  }

  hasActiveProduct(productId: string): boolean {
    return [...this.tasks.values()].some(
      (record) =>
        record.task.productId === productId && !isTerminal(record.task.phase)
    )
  }

  hasActiveTasks(): boolean {
    return [...this.tasks.values()].some((record) => !isTerminal(record.task.phase))
  }

  cancelInstall(taskId: string): void {
    const record = this.tasks.get(taskId)
    if (!record || isTerminal(record.task.phase)) return

    if (!record.active) {
      record.task.phase = 'cancelled'
      record.task.message = 'Cancelled'
      record.task.finishedAt = new Date().toISOString()
      this.broadcast(true)
      return
    }

    record.task.message = 'Cancelling…'
    this.broadcast(true)
    record.controller?.abort()
  }

  clearFinished(): void {
    for (const [id, record] of this.tasks) {
      if (isTerminal(record.task.phase)) this.tasks.delete(id)
    }
    this.broadcast(true)
  }

  /**
   * Cleans abandoned staging folders and restores a previous app version if a
   * crash interrupted the swap in the middle of an update.
   */
  async recover(): Promise<void> {
    const root = this.options.config.get().installRoot
    await ensureDir(root)

    await removePath(join(root, '.tmp')).catch((error) => {
      this.log.warn('Could not clear the temporary download folder.', error)
    })

    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      this.log.warn('Could not inspect the install library.', error)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name)) continue
      const productDir = join(root, entry.name)
      const appDir = join(productDir, 'app')

      let files: string[]
      try {
        files = await readdir(productDir)
      } catch {
        continue
      }

      const staging = files.filter((file) => file.startsWith('.staging-'))
      const backups = files
        .filter((file) => file.startsWith('.old-'))
        .sort()
        .reverse()

      if (!existsSync(appDir) && backups.length > 0) {
        const newest = backups.shift() as string
        try {
          await rename(join(productDir, newest), appDir)
          this.log.warn(
            `Recovered the previous files for ${entry.name} after an interrupted update.`
          )
        } catch (error) {
          this.log.error(`Could not recover ${entry.name} after an interrupted update.`, error)
        }
      }

      for (const backup of backups) {
        await removePath(join(productDir, backup)).catch(() => undefined)
      }
      for (const folder of staging) {
        await removePath(join(productDir, folder)).catch(() => undefined)
      }
    }
  }

  private pump(): void {
    const activeCount = [...this.tasks.values()].filter((record) => record.active).length
    if (activeCount >= MAX_CONCURRENT_INSTALLS) return

    const next = [...this.tasks.values()].find(
      (record) => !record.active && record.task.phase === 'queued'
    )
    if (!next) return

    void this.run(next)
    this.pump()
  }

  private async run(record: TaskRecord): Promise<void> {
    const { task, request } = record
    record.active = true
    task.phase = 'downloading'
    task.message = `Downloading ${request.assetName}`
    task.startedAt = new Date().toISOString()
    this.broadcast(true)

    const installRoot = this.options.config.get().installRoot
    const productDir = productDirectory(installRoot, request.productId)
    const temporaryDir = join(installRoot, '.tmp', task.id)
    const downloadPath = join(temporaryDir, 'archive')
    const stagingDir = join(productDir, `.staging-${task.id}`)

    const controller = new AbortController()
    record.controller = controller
    const signal = controller.signal

    try {
      await ensureDir(temporaryDir)
      await ensureDir(productDir)

      this.log.info(`Downloading ${request.downloadUrl}`)
      const download = await downloadFile({
        url: request.downloadUrl,
        destination: downloadPath,
        expectedBytes: request.sizeBytes,
        digest: request.digest,
        signal,
        onProgress: (received, total) => this.updateProgress(record, received, total),
        onDownloaded: () => {
          task.speedBytesPerSec = 0
          task.message = 'Verifying download'
          this.broadcast(true)
        }
      })

      if (signal.aborted) throw new AbortError()

      task.phase = 'extracting'
      task.message = 'Extracting'
      this.broadcast(true)

      await extractArchive(downloadPath, stagingDir, request.assetName, {
        signal,
        logger: this.log,
        onEntry: (count) => {
          task.message = `Extracting (${count} file${count === 1 ? '' : 's'})`
          this.broadcast()
        }
      })

      if (signal.aborted) throw new AbortError()

      task.phase = 'finalizing'
      task.message = 'Finishing install'
      task.speedBytesPerSec = 0
      this.broadcast(true)

      const detection = await detectExecutable(
        stagingDir,
        this.platform,
        request.name,
        request.executable,
        this.log
      )
      if (!detection.executable) {
        throw new Error(
          detection.warning ??
            'No runnable executable was detected in this build. Set the executable path in the catalog.'
        )
      }

      task.message = 'Measuring installed files'
      this.broadcast(true)
      const installedBytes = await directorySize(stagingDir)
      const existing = await readManifest(productDir)
      const now = new Date().toISOString()
      const manifest: InstallManifest = {
        schemaVersion: 1,
        productId: request.productId,
        name: request.name,
        version: request.version,
        repo: request.repo,
        releaseUrl: request.releaseUrl,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        executable: detection.executable,
        args: request.args,
        sizeBytes: installedBytes > 0 ? installedBytes : download.bytes,
        assetName: request.assetName,
        digest: request.digest
      }

      await this.swapIntoPlace(productDir, stagingDir, manifest)

      task.phase = 'done'
      task.message = 'Ready to play'
      task.receivedBytes = installedBytes > 0 ? installedBytes : download.bytes
      task.totalBytes = installedBytes > 0 ? installedBytes : download.bytes
      task.finishedAt = new Date().toISOString()
      this.log.info(`Installed ${request.productId} ${request.version}.`)
      this.options.emitLibraryChanged()
    } catch (error) {
      const aborted =
        signal.aborted || error instanceof AbortError || (error as Error)?.name === 'AbortError'

      if (aborted) {
        task.phase = 'cancelled'
        task.message = 'Cancelled'
        task.speedBytesPerSec = 0
        task.finishedAt = new Date().toISOString()
        this.log.info(`Install cancelled for ${request.productId}.`)
      } else {
        const message = friendlyInstallError(error)
        task.phase = 'error'
        task.error = message
        task.message = message
        task.speedBytesPerSec = 0
        task.finishedAt = new Date().toISOString()
        this.log.error(`Install failed for ${request.productId}.`, error)
      }
    } finally {
      record.controller = null
      record.active = false
      record.sample = null
      await removePath(temporaryDir).catch(() => undefined)
      if (existsSync(stagingDir)) {
        await removePath(stagingDir).catch(() => undefined)
      }
      this.broadcast(true)
      this.pump()
    }
  }

  private async swapIntoPlace(
    productDir: string,
    stagingDir: string,
    manifest: InstallManifest
  ): Promise<void> {
    const appDir = join(productDir, 'app')
    const backupDir = join(
      productDir,
      `.old-${Date.now()}-${manifest.productId.slice(0, 6)}`
    )
    let movedOld = false
    let movedNew = false

    try {
      if (existsSync(appDir)) {
        await rename(appDir, backupDir)
        movedOld = true
      }
      await rename(stagingDir, appDir)
      movedNew = true
      await writeManifest(productDir, manifest)
    } catch (error) {
      try {
        if (movedNew) await removePath(appDir)
        if (movedOld && !existsSync(appDir)) await rename(backupDir, appDir)
      } catch (rollbackError) {
        this.log.error('Could not roll back a failed install swap.', rollbackError)
      }
      throw new Error(swapErrorMessage(error), { cause: error })
    }

    if (existsSync(backupDir)) {
      await removePath(backupDir).catch((error) => {
        this.log.warn('Could not remove the previous version backup.', error)
      })
    }
  }

  private updateProgress(record: TaskRecord, receivedBytes: number, totalBytes: number): void {
    const { task } = record
    const now = Date.now()
    task.receivedBytes = receivedBytes
    if (totalBytes > 0) task.totalBytes = totalBytes

    if (record.sample) {
      const elapsed = (now - record.sample.at) / 1000
      if (elapsed >= 0.3) {
        const instant = Math.max(0, (receivedBytes - record.sample.bytes) / elapsed)
        task.speedBytesPerSec =
          task.speedBytesPerSec > 0
            ? task.speedBytesPerSec * 0.65 + instant * 0.35
            : instant
        record.sample = { at: now, bytes: receivedBytes }
      }
    } else {
      record.sample = { at: now, bytes: receivedBytes }
    }

    this.broadcast()
  }

  private broadcast(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastQueueEmit < 180) return
    this.lastQueueEmit = now
    this.options.emitTasks(this.getTasks())
  }

  private validateRequest(raw: InstallRequest): InstallRequest {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid install request.')
    const productId = assertProductId(String(raw.productId ?? ''))

    const name = cleanText(raw.name, 120)
    if (!name) throw new Error('The product name is missing.')

    const version = cleanText(raw.version, 80)
    if (!version) throw new Error('The release version is missing.')

    const repo = cleanText(raw.repo, 160)
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error('The repository name is invalid.')
    }

    const assetName = basename(cleanText(raw.assetName, 240))
    if (!SUPPORTED_ARCHIVE.test(assetName)) {
      throw new Error('Only .zip, .tar.gz, and .tgz release assets can be installed.')
    }

    const sizeBytes = Number(raw.sizeBytes)
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_ARCHIVE_BYTES) {
      throw new Error('The release asset size is invalid.')
    }

    const downloadUrl = this.validateDownloadUrl(String(raw.downloadUrl ?? ''))
    const releaseUrl = validateHttpUrl(String(raw.releaseUrl ?? ''), 'release page')

    let executable: string | null = null
    if (raw.executable !== null && raw.executable !== undefined) {
      const safe = safeRelativePath(String(raw.executable))
      if (!safe) throw new Error('The configured executable path is invalid.')
      executable = safe.replace(/\\/g, '/')
    }

    const args = Array.isArray(raw.args)
      ? raw.args
          .filter((arg): arg is string => typeof arg === 'string' && arg.length <= 512)
          .slice(0, 32)
      : []

    return {
      productId,
      name,
      version,
      repo,
      releaseUrl,
      assetName,
      downloadUrl,
      sizeBytes,
      digest: normalizeDigest(raw.digest),
      executable,
      args
    }
  }

  private validateDownloadUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('The download URL is invalid.')
    }

    const backend = new URL(this.options.config.get().backendUrl)
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    const isLocal = localHosts.has(url.hostname)
    const allowHttp = isLocal && backend.protocol === 'http:'

    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
      throw new Error('Downloads must use https.')
    }
    if (
      !URL_HOST_ALLOWLIST.has(url.hostname) &&
      !url.hostname.endsWith('.githubusercontent.com') &&
      url.hostname !== backend.hostname &&
      !isLocal
    ) {
      throw new Error('Downloads must come from GitHub or the configured relay.')
    }
    return url.toString()
  }
}

function isTerminal(phase: InstallPhase): boolean {
  return phase === 'done' || phase === 'error' || phase === 'cancelled'
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
}

function normalizeDigest(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const hex = value.trim().toLowerCase().replace(/^sha256:/, '')
  return /^[a-f0-9]{64}$/.test(hex) ? `sha256:${hex}` : null
}

function validateHttpUrl(value: string, label: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new Error(`The ${label} URL is invalid.`)
  }
}

function friendlyInstallError(error: unknown): string {
  if (!error) return 'The install failed for an unknown reason.'
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOSPC/i.test(message)) {
    return 'Not enough disk space to install this build.'
  }
  if (/EACCES|EPERM/i.test(message) && process.platform === 'win32') {
    return 'Windows denied access while writing files. Close the app and try again.'
  }
  return message.slice(0, 500)
}

function swapErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return 'Could not replace the installed files. Close the product (including any background processes) and try again.'
  }
  return `Could not finish the install: ${error instanceof Error ? error.message : String(error)}`
}
