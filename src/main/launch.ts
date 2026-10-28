import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { isInsideRoot } from './fs-utils'
import type { LibraryService } from './library'
import type { Logger } from './logger'

interface RunningEntry {
  pid: number
  child: ChildProcess
  startedAt: number
}

export class LaunchService {
  private readonly running = new Map<string, RunningEntry>()

  constructor(
    private readonly library: LibraryService,
    private readonly log: Logger,
    private readonly onRunningChanged: (productIds: string[]) => void
  ) {}

  isRunning(productId: string): boolean {
    const entry = this.running.get(productId)
    if (!entry) return false
    if (isProcessAlive(entry.pid)) return true
    this.running.delete(productId)
    return false
  }

  getRunning(): string[] {
    const ids = [...this.running.keys()].filter((id) => this.isRunning(id))
    return ids
  }

  async launch(productId: string): Promise<{ pid: number }> {
    if (this.isRunning(productId)) {
      throw new Error('That product is already running.')
    }

    const product = await this.library.read(productId)
    if (!product) throw new Error('That product is not installed.')
    if (!product.executablePath) {
      throw new Error(
        'No executable is recorded for this install. Reinstall it or fix the executable path in the catalog.'
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
    this.running.set(product.id, { pid, child, startedAt: Date.now() })
    this.onRunningChanged(this.getRunning())

    child.once('exit', (code, signal) => {
      this.running.delete(product.id)
      this.log.info(
        `${product.name} exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`
      )
      this.onRunningChanged(this.getRunning())
    })

    return { pid }
  }

  async ensureStopped(productId: string): Promise<void> {
    if (this.isRunning(productId)) {
      throw new Error('Close the product before installing or uninstalling it.')
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
