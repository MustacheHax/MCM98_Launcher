import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'

export interface DownloadOptions {
  url: string
  destination: string
  expectedBytes: number
  digest: string | null
  signal: AbortSignal
  onProgress: (receivedBytes: number, totalBytes: number) => void
  onDownloaded: () => void
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

/**
 * Downloads a release asset to disk. Verifies GitHub's sha256 digest when one
 * is present, and removes the partial file on any failure.
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  await mkdir(dirname(options.destination), { recursive: true })

  let response: Response
  try {
    response = await net.fetch(options.url, {
      signal: options.signal,
      redirect: 'follow'
    })
  } catch (error) {
    if (options.signal.aborted) throw new AbortError()
    throw new Error(
      `Download failed: ${error instanceof Error ? error.message : 'the relay could not be reached'}.`
    )
  }

  if (!response.ok) {
    let detail = ''
    try {
      const text = (await response.text()).slice(0, 240)
      const payload = JSON.parse(text) as { error?: string }
      detail = payload.error ?? ''
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(
      `Download failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`
    )
  }

  if (!response.body) throw new Error('Download failed: the relay returned no data.')

  const headerLength = Number(response.headers.get('content-length'))
  const totalBytes = headerLength > 0 ? headerLength : options.expectedBytes
  const hash = createHash('sha256')
  let receivedBytes = 0
  let lastReported = 0

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
      createWriteStream(options.destination),
      { signal: options.signal }
    )
  } catch (error) {
    await rm(options.destination, { force: true }).catch(() => undefined)
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
    await rm(options.destination, { force: true }).catch(() => undefined)
    throw new Error(
      'Checksum verification failed. The download was incomplete or corrupted; please try again.'
    )
  }

  if (totalBytes > 0 && receivedBytes !== totalBytes) {
    await rm(options.destination, { force: true }).catch(() => undefined)
    throw new Error('Download was incomplete. Please try again.')
  }

  return { bytes: receivedBytes, digest: actualDigest }
}

export class AbortError extends Error {
  constructor() {
    super('Installation cancelled.')
    this.name = 'AbortError'
  }
}
