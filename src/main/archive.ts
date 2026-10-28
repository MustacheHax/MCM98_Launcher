import { createWriteStream } from 'node:fs'
import { chmod, mkdir, open, symlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import * as yauzl from 'yauzl'
import { AbortError } from './download'
import type { Logger } from './logger'

const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const MAX_SYMLINK_BYTES = 4096

export interface ExtractOptions {
  signal: AbortSignal
  logger: Logger
  onEntry: (entriesExtracted: number) => void
}

/**
 * Converts an archive entry name into a path relative to the destination.
 * Absolute paths, drive letters, NUL bytes, and .. traversal return null.
 */
export function safeArchivePath(name: string): string | null {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null
  }
  if (normalized.includes('\0')) return null
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join(sep)
}

async function detectKind(file: string, name: string): Promise<'zip' | 'tar'> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar'

  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, 4, 0)
    if (bytesRead >= 4 && header[0] === 0x50 && header[1] === 0x4b) return 'zip'
    if (bytesRead >= 2 && header[0] === 0x1f && header[1] === 0x8b) return 'tar'
  } finally {
    await handle.close()
  }
  throw new Error('Unsupported release format. Publish a .zip, .tar.gz, or .tgz archive.')
}

async function readZipEntry(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
  limit: number
): Promise<Buffer> {
  const stream = await new Promise<Readable>((resolveStream, reject) => {
    zipfile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) {
        reject(error ?? new Error(`Could not read archive entry ${entry.fileName}.`))
        return
      }
      resolveStream(readStream as unknown as Readable)
    })
  })

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > limit) {
      stream.destroy()
      throw new Error('Archive contains an oversized symbolic link.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function extractZip(
  file: string,
  destination: string,
  options: ExtractOptions
): Promise<void> {
  const zipfile = await yauzl.openPromise(file, { lazyEntries: true, autoClose: true })
  let entriesExtracted = 0

  try {
    await new Promise<void>((resolveDone, rejectDone) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        try {
          zipfile.close()
        } catch {
          // Ignore close errors.
        }
        if (error) rejectDone(error)
        else resolveDone()
      }

      const handleEntry = async (entry: yauzl.Entry): Promise<void> => {
        if (options.signal.aborted) throw new AbortError()

        const relativePath = safeArchivePath(entry.fileName)
        if (!relativePath) {
          options.logger.warn(`Skipped unsafe archive entry: ${entry.fileName}`)
          return
        }

        const target = resolve(destination, relativePath)
        if (!target.startsWith(destination + sep) && target !== destination) {
          throw new Error(`Archive entry escaped the destination: ${entry.fileName}`)
        }
        if (target === destination) return

        const attributes = entry.externalFileAttributes >>> 0
        const mode = (attributes >>> 16) & 0xffff
        const fileType = mode & S_IFMT
        const isDirectory =
          entry.fileName.endsWith('/') ||
          entry.fileName.endsWith('\\') ||
          (attributes & 0x10) !== 0

        if (isDirectory) {
          await mkdir(target, { recursive: true })
          return
        }

        await mkdir(dirname(target), { recursive: true })

        if (fileType === S_IFLNK) {
          if (process.platform === 'win32') {
            options.logger.warn(`Skipped symlink on Windows: ${entry.fileName}`)
            return
          }
          const targetBytes = await readZipEntry(zipfile, entry, MAX_SYMLINK_BYTES)
          const linkTarget = targetBytes.toString('utf8')
          if (
            !linkTarget ||
            linkTarget.startsWith('/') ||
            /^[A-Za-z]:/.test(linkTarget) ||
            linkTarget.includes('\0')
          ) {
            options.logger.warn(`Skipped unsafe symlink: ${entry.fileName}`)
            return
          }
          const resolvedLink = resolve(dirname(target), linkTarget)
          if (!resolvedLink.startsWith(destination + sep)) {
            options.logger.warn(`Skipped symlink escaping the install folder: ${entry.fileName}`)
            return
          }
          await symlink(linkTarget, target).catch((error) => {
            options.logger.warn(`Could not create symlink ${entry.fileName}:`, error)
          })
          return
        }

        const stream = await new Promise<Readable>((resolveStream, reject) => {
          zipfile.openReadStream(entry, (error, readStream) => {
            if (error || !readStream) {
              reject(error ?? new Error(`Could not read archive entry ${entry.fileName}.`))
              return
            }
            resolveStream(readStream as unknown as Readable)
          })
        })

        const permissions = process.platform === 'win32' ? undefined : mode & 0o777
        await pipeline(
          stream,
          createWriteStream(target, permissions ? { mode: permissions } : undefined),
          { signal: options.signal }
        )

        if (process.platform !== 'win32' && (mode & 0o777) !== 0) {
          await chmod(target, mode & 0o777)
        }
        entriesExtracted += 1
        options.onEntry(entriesExtracted)
      }

      zipfile.on('error', (error) => finish(error))
      zipfile.on('end', () => finish())
      zipfile.on('entry', (entry: yauzl.Entry) => {
        void handleEntry(entry)
          .then(() => {
            if (!settled) zipfile.readEntry()
          })
          .catch((error: unknown) => {
            finish(error instanceof Error ? error : new Error(String(error)))
          })
      })

      zipfile.readEntry()
    })
  } finally {
    try {
      zipfile.close()
    } catch {
      // Already closed.
    }
  }
}

async function extractTar(
  file: string,
  destination: string,
  options: ExtractOptions
): Promise<void> {
  let entriesExtracted = 0
  await mkdir(destination, { recursive: true })

  await tar.x({
    file,
    cwd: destination,
    preservePaths: false,
    strict: true,
    unlink: true,
    filter: (entryPath) => {
      if (options.signal.aborted) throw new AbortError()
      const safe = safeArchivePath(entryPath)
      if (!safe) {
        options.logger.warn(`Skipped unsafe archive entry: ${entryPath}`)
        return false
      }
      return true
    },
    onentry: () => {
      entriesExtracted += 1
      options.onEntry(entriesExtracted)
    }
  })

  if (options.signal.aborted) throw new AbortError()
}

export async function extractArchive(
  file: string,
  destination: string,
  archiveName: string,
  options: ExtractOptions
): Promise<void> {
  await mkdir(destination, { recursive: true })
  const kind = await detectKind(file, archiveName)
  options.logger.info(`Extracting ${archiveName} (${kind}) to ${destination}`)

  if (kind === 'zip') {
    await extractZip(file, destination, options)
  } else {
    await extractTar(file, destination, options)
  }

  if (options.signal.aborted) throw new AbortError()
}
