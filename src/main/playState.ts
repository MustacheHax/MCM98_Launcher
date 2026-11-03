import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PlayRecord, PlayState } from '@shared/types'
import type { Logger } from './logger'

interface RunningEntry {
  pid: number
  startedAt: string
}

interface StoredPlayState {
  version: 1
  running: Record<string, RunningEntry>
  history: Record<string, PlayRecord>
}

/**
 * Clock changes and machine sleep can produce absurd session lengths, so one
 * session never counts for more than a day.
 */
const MAX_SESSION_MS = 24 * 60 * 60 * 1000

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Play history plus live running state for installed products.
 *
 * Running entries are written to disk so a launcher restart still knows which
 * products are open. Without that, uninstalling or updating from a fresh
 * launcher would race the running executable and fail with a busy-file error.
 */
export class PlayStateStore {
  private readonly running = new Map<string, RunningEntry>()
  private readonly history = new Map<string, PlayRecord>()
  private lastSaved = ''

  constructor(
    private readonly file: string,
    private readonly log: Logger
  ) {
    this.load()
    this.reapDead()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredPlayState>

      for (const [id, value] of Object.entries(parsed.running ?? {})) {
        const entry = value as Partial<RunningEntry> | null
        const pid = Number(entry?.pid)
        const startedAt = typeof entry?.startedAt === 'string' ? entry.startedAt : ''
        if (!Number.isInteger(pid) || pid <= 0 || !startedAt) continue
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue
        this.running.set(id, { pid, startedAt })
      }

      for (const [id, value] of Object.entries(parsed.history ?? {})) {
        const record = value as Partial<PlayRecord> | null
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue
        if (!record) continue
        this.history.set(id, {
          productId: id,
          lastPlayedAt: typeof record.lastPlayedAt === 'string' ? record.lastPlayedAt : null,
          playtimeMs: Number.isFinite(record.playtimeMs) ? Math.max(0, Number(record.playtimeMs)) : 0,
          launches: Number.isFinite(record.launches) ? Math.max(0, Math.floor(Number(record.launches))) : 0
        })
      }
    } catch (error) {
      this.log.warn('Could not read the play history; starting fresh.', error)
    }
  }

  private save(): void {
    const payload: StoredPlayState = {
      version: 1,
      running: Object.fromEntries(this.running),
      history: Object.fromEntries(this.history)
    }
    const serialized = `${JSON.stringify(payload, null, 2)}\n`
    if (serialized === this.lastSaved) return

    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      writeFileSync(temporary, serialized, 'utf8')
      renameSync(temporary, this.file)
      this.lastSaved = serialized
    } catch (error) {
      this.log.warn('Could not save the play history.', error)
    }
  }

  private record(productId: string): PlayRecord {
    const existing = this.history.get(productId)
    if (existing) return existing
    const created: PlayRecord = {
      productId,
      lastPlayedAt: null,
      playtimeMs: 0,
      launches: 0
    }
    this.history.set(productId, created)
    return created
  }

  markLaunched(productId: string, pid: number): void {
    this.running.set(productId, { pid, startedAt: new Date().toISOString() })
    this.record(productId).launches += 1
    this.save()
  }

  /** Closes a session and folds its length into the stored playtime. */
  markExited(productId: string): void {
    const entry = this.running.get(productId)
    this.running.delete(productId)
    if (entry) {
      const record = this.record(productId)
      const startedAt = Date.parse(entry.startedAt)
      if (Number.isFinite(startedAt)) {
        const elapsed = Math.min(Math.max(0, Date.now() - startedAt), MAX_SESSION_MS)
        record.playtimeMs += elapsed
      }
      record.lastPlayedAt = new Date().toISOString()
    }
    this.save()
  }

  isRunning(productId: string): boolean {
    const entry = this.running.get(productId)
    if (!entry) return false
    return isProcessAlive(entry.pid)
  }

  /**
   * Drops sessions whose process is gone, folding their playtime in. Returns
   * the ids that ended so callers can notify the renderer.
   */
  reapDead(): string[] {
    const ended: string[] = []
    for (const [id, entry] of [...this.running]) {
      if (isProcessAlive(entry.pid)) continue
      this.markExited(id)
      ended.push(id)
    }
    if (ended.length > 0) {
      this.log.info(`Closed play session(s): ${ended.join(', ')}.`)
    }
    return ended
  }

  liveIds(): string[] {
    this.reapDead()
    return [...this.running.keys()]
  }

  getState(): PlayState {
    return Object.fromEntries([...this.history].map(([id, record]) => [id, { ...record }]))
  }
}
