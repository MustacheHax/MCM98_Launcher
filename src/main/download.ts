import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'

export interface DownloadOptions {
  url: string
  destination: string
  /** Partial file kept between attempts so an interrupted download resumes. */
  partialPath: string
  expectedBytes: number
  digest: string | null
  signal: AbortSignal
  onProgress: (receivedBytes: number, totalBytes: number) => void
  onDownloaded: () => void
  /** Fired when an earlier partial file is being continued. */
  onResume?: (existingBytes: number, totalBytes: number) => void
}

export interface DownloadResult {
  bytes: number
  digest: string
}

const PROGRESS_STEP_BYTES = 512 * 1024

function parseExpectedDigest(digest: string | null): string | null {
  if (!digest) return null
  const normalized = digest.trim().toLowerCase().replace(/^sha256:/, '')
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

/** Reads the total size out of `Content-Range: bytes 0-1/1234`. */
function contentRangeTotal(value: string | null): number {
  if (!value) return 0
  const match = /\/(\d+)\s*$/.exec(value)
  return match?.[1] ? Number(match[1]) : 0
}

async function partialSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

async function hashExistingBytes(hash: Hash, path: string, bytes: number): Promise<void> {
  if (bytes <= 0) return
  const stream = createReadStream(path, { start: 0, end: bytes - 1 })
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
}

async function moveIntoPlace(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    // The partial file lives in the app data folder and the install folder may
    // be on another drive, where rename cannot cross volumes.
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error
    await copyFile(from, to)
    await rm(from, { force: true }).catch(() => undefined)
  }
}

function readErrorDetail(response: Response): Promise<string> {
  return response
    .text()
    .then((text) => {
      try {
        const payload = JSON.parse(text.slice(0, 400)) as { error?: string }
        return payload.error ?? ''
      } catch {
        return ''
      }
    })
    .catch(() => '')
}

/**
 * Downloads a release asset to disk, resuming an interrupted transfer when the
 * server honours `Range`. GitHub's asset hosts and the relay both do; anything
 * that ignores the header simply restarts from zero. The sha256 digest is
 * verified over the whole file before it replaces the destination, and a
 * failed transfer keeps its partial file so the next attempt can continue.
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  await mkdir(dirname(options.destination), { recursive: true })
  await mkdir(dirname(options.partialPath), { recursive: true })

  let existing = await partialSize(options.partialPath)
  if (options.expectedBytes > 0 && existing > options.expectedBytes) {
    await rm(options.partialPath, { force: true })
    existing = 0
  }

  let response = await request(options, existing)

  // A stale partial (a newer build, a changed digest) can make the range
  // unsatisfiable. Drop it and try once more from the beginning.
  if (response.status === 416 && existing > 0) {
    await rm(options.partialPath, { force: true })
    existing = 0
    response = await request(options, 0)
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(`Download failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`)
  }

  // The server ignored the range, so the body starts at byte zero.
  if (existing > 0 && response.status === 200) existing = 0

  if (!response.body) throw new Error('Download failed: the relay returned no data.')

  const headerLength = Number(response.headers.get('content-length'))
  const totalBytes =
    response.status === 206
      ? contentRangeTotal(response.headers.get('content-range')) ||
        existing + (headerLength > 0 ? headerLength : 0)
      : headerLength > 0
        ? headerLength
        : options.expectedBytes

  if (existing > 0) options.onResume?.(existing, totalBytes)

  const hash = createHash('sha256')
  await hashExistingBytes(hash, options.partialPath, existing)

  let receivedBytes = existing
  let lastReported = existing

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      hash.update(chunk)
      if (receivedBytes - lastReported >= PROGRESS_STEP_BYTES) {
        lastReported = receivedBytes
        options.onProgress(receivedBytes, totalBytes)
      }
      callback(null, chunk)
    }
  })

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      meter,
      createWriteStream(options.partialPath, { flags: existing > 0 ? 'a' : 'w' }),
      { signal: options.signal }
    )
  } catch (error) {
    if (options.signal.aborted) throw new AbortError()
    throw new Error(
      `Download failed while writing the file: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  options.onProgress(receivedBytes, totalBytes)
  options.onDownloaded()

  const actualDigest = hash.digest('hex')
  const expectedDigest = parseExpectedDigest(options.digest)
  if (expectedDigest && expectedDigest !== actualDigest) {
    await rm(options.partialPath, { force: true }).catch(() => undefined)
    throw new Error(
      'Checksum verification failed. The download was incomplete or corrupted; please try again.'
    )
  }

  if (totalBytes > 0 && receivedBytes !== totalBytes) {
    throw new Error('Download was incomplete. Try again to resume where it stopped.')
  }

  await moveIntoPlace(options.partialPath, options.destination)
  return { bytes: receivedBytes, digest: actualDigest }
}

async function request(options: DownloadOptions, existing: number): Promise<Response> {
  try {
    return await net.fetch(options.url, {
      signal: options.signal,
      redirect: 'follow',
      headers: existing > 0 ? { Range: `bytes=${existing}-` } : undefined
    })
  } catch (error) {
    if (options.signal.aborted) throw new AbortError()
    throw new Error(
      `Download failed: ${error instanceof Error ? error.message : 'the relay could not be reached'}.`
    )
  }
}

export class AbortError extends Error {
  constructor() {
    super('Installation cancelled.')
    this.name = 'AbortError'
  }
}
