import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

type Level = 'info' | 'warn' | 'error' | 'debug'

const MAX_LOG_BYTES = 5 * 1024 * 1024

export class Logger {
  readonly path: string
  private readonly fileOnly: boolean

  constructor(logPath: string, fileOnly = false) {
    this.path = logPath
    this.fileOnly = fileOnly
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) {
        const rotated = `${logPath}.1`
        rmSync(rotated, { force: true })
        renameSync(logPath, rotated)
      }
    } catch {
      // Logging must never prevent the launcher from starting.
    }
  }

  private write(level: Level, message: string, detail?: unknown): void {
    const suffix =
      detail instanceof Error
        ? ` ${detail.stack ?? detail.message}`
        : detail === undefined
          ? ''
          : ` ${safeStringify(detail)}`
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${suffix}\n`

    if (!this.fileOnly) {
      const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      target(line.trimEnd())
    }

    try {
      appendFileSync(this.path, line, 'utf8')
    } catch {
      // Ignore log write failures.
    }
  }

  info(message: string, detail?: unknown): void {
    this.write('info', message, detail)
  }

  warn(message: string, detail?: unknown): void {
    this.write('warn', message, detail)
  }

  error(message: string, detail?: unknown): void {
    this.write('error', message, detail)
  }

  debug(message: string, detail?: unknown): void {
    this.write('debug', message, detail)
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
