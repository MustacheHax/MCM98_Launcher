import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { PlayState } from '@shared/types'
import { isInsideRoot } from './fs-utils'
import type { LibraryService } from './library'
import type { Logger } from './logger'
import type { PlayStateStore } from './playState'

/** How often adopted (previously launched) processes are checked for exit. */
const WATCH_INTERVAL_MS = 4_000

export class LaunchService {
  private readonly children = new Map<string, ChildProcess>()
  private watcher: NodeJS.Timeout | null = null

  constructor(
    private readonly library: LibraryService,
    private readonly log: Logger,
    private readonly playState: PlayStateStore,
    private readonly onChanged: (running: string[], state: PlayState) => void
  ) {}

  isRunning(productId: string): boolean {
    return this.playState.isRunning(productId)
  }

  getRunning(): string[] {
    return this.playState.liveIds()
  }

  getPlayState(): PlayState {
    return this.playState.getState()
  }

  /**
   * Adopts sessions that outlived the launcher. Games launched before a
   * restart have no child handle here, so a watcher polls their pid instead.
   */
  resume(): void {
    const live = this.getRunning()
    if (live.length > 0) {
      this.log.info(`Still running from a previous session: ${live.join(', ')}.`)
    }
    this.ensureWatcher()
    this.notify()
  }

  async launch(productId: string): Promise<{ pid: number }> {
    if (this.isRunning(productId)) {
      throw new Error('That product is already running.')
    }

    const product = await this.library.read(productId)
    if (!product) throw new Error('That product is not installed.')
    if (!product.executablePath) {
      throw new Error(
        'No executable is recorded for this install. Repair the install or fix the executable path in the catalog.'
      )
    }
    if (!isInsideRoot(product.appPath, product.executablePath)) {
      throw new Error('The recorded executable is outside the install folder.')
    }

    const info = await stat(product.executablePath).catch(() => null)
    if (!info?.isFile()) {
      throw new Error('The installed executable is missing. Repair or reinstall the product.')
    }

    this.log.info(`Launching ${product.id} (${basename(product.executablePath)}).`)
    const child = spawn(product.executablePath, product.args, {
      cwd: dirname(product.executablePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolveSpawn()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        rejectSpawn(
          new Error(
            `Could not launch ${product.name}: ${error.message}. The build may be missing a runtime or permissions.`
          )
        )
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    const pid = child.pid
    if (!pid) throw new Error('The game process did not start.')

    child.unref()
    this.children.set(product.id, child)
    this.playState.markLaunched(product.id, pid)
    this.ensureWatcher()
    this.notify()

    child.once('exit', (code, signal) => {
      this.children.delete(product.id)
      this.playState.markExited(product.id)
      this.log.info(
        `${product.name} exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`
      )
      this.notify()
    })

    return { pid }
  }

  async ensureStopped(productId: string): Promise<void> {
    if (this.isRunning(productId)) {
      throw new Error('Close the product before installing or uninstalling it.')
    }
  }

  private notify(): void {
    this.onChanged(this.getRunning(), this.playState.getState())
  }

  private ensureWatcher(): void {
    if (this.watcher) return
    if (this.getRunning().length === 0) return

    this.watcher = setInterval(() => {
      const ended = this.playState.reapDead()
      if (ended.length > 0) this.notify()
      if (this.playState.liveIds().length === 0) this.stopWatcher()
    }, WATCH_INTERVAL_MS)
    this.watcher.unref()
  }

  private stopWatcher(): void {
    if (!this.watcher) return
    clearInterval(this.watcher)
    this.watcher = null
  }
}
