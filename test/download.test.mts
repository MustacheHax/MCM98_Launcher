import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, describe, it } from 'node:test'
import { downloadFile } from '../src/main/download'

/**
 * The transport is injected, so these tests run the real downloader against a
 * local server instead of Electron's network stack.
 */
const fetchImpl = (url: string, init: RequestInit): Promise<Response> => fetch(url, init)

const payload = Buffer.alloc(400_000)
for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 37) % 251
const total = payload.length
const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`

interface Harness {
  server: Server
  url: string
  ranges: string[]
  /** When false the server answers 200 and ignores `Range`, like a dumb proxy. */
  honourRange: boolean
  /** When true the first range request is rejected with 416. */
  rejectFirstRange: boolean
}

async function startServer(): Promise<Harness> {
  const harness: Harness = {
    server: createServer((req, res) => {
      const range = req.headers.range
      harness.ranges.push(typeof range === 'string' ? range : '')

      if (typeof range === 'string' && harness.honourRange) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range)
        const start = Number(match?.[1] ?? 0)
        const end = match?.[2] ? Number(match[2]) : total - 1

        if (harness.rejectFirstRange && harness.ranges.length === 1) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` })
          res.end()
          return
        }
        if (start >= total) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` })
          res.end()
          return
        }

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes'
        })
        res.end(payload.subarray(start, end + 1))
        return
      }

      res.writeHead(200, { 'Content-Length': String(total) })
      res.end(payload)
    }),
    url: '',
    ranges: [],
    honourRange: true,
    rejectFirstRange: false
  }

  await new Promise<void>((resolve) => harness.server.listen(0, '127.0.0.1', resolve))
  const address = harness.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  harness.url = `http://127.0.0.1:${port}/asset`
  return harness
}

describe('downloadFile', () => {
  let harness: Harness
  let dir = ''

  before(async () => {
    harness = await startServer()
  })

  after(() => {
    harness.server.close()
  })

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  /** A fresh destination/partial pair plus a seeded partial of `existing` bytes. */
  function setup(existing: number): { destination: string; partialPath: string } {
    dir = mkdtempSync(join(tmpdir(), 'mcm98-download-'))
    const partialPath = join(dir, 'downloads', 'asset.part')
    mkdirSync(join(dir, 'downloads'), { recursive: true })
    if (existing > 0) writeFileSync(partialPath, payload.subarray(0, existing))
    harness.ranges = []
    return { destination: join(dir, 'out', 'archive'), partialPath }
  }


  it('continues an interrupted transfer and verifies the whole file', async () => {
    const files = setup(150_000)

    let resumed = 0
    harness.honourRange = true
    const result = await downloadFile({
      ...files,
      url: harness.url,
      expectedBytes: total,
      digest,
      signal: new AbortController().signal,
      fetchImpl,
      onProgress: () => {},
      onResume: (existing) => {
        resumed = existing
      },
      onDownloaded: () => {}
    })

    assert.equal(resumed, 150_000, 'the resume offset should be reported')
    assert.equal(harness.ranges.at(-1), 'bytes=150000-', 'only the missing bytes are requested')
    assert.equal(result.bytes, total)
    assert.equal(`sha256:${result.digest}`, digest)
    assert.ok(readFileSync(files.destination).equals(payload), 'the file should match the payload')
    assert.equal(existsSync(files.partialPath), false, 'the partial is consumed on success')
  })

  it('restarts from zero when the server ignores Range', async () => {
    const files = setup(5_000)

    harness.honourRange = false
    const result = await downloadFile({
      ...files,
      url: harness.url,
      expectedBytes: total,
      digest,
      signal: new AbortController().signal,
      fetchImpl,
      onProgress: () => {},
      onDownloaded: () => {}
    })

    assert.equal(result.bytes, total)
    assert.ok(readFileSync(files.destination).equals(payload))
    harness.honourRange = true
  })

  it('drops an unsatisfiable partial and retries from the start', async () => {
    const files = setup(1_000)

    harness.rejectFirstRange = true
    const result = await downloadFile({
      ...files,
      url: harness.url,
      expectedBytes: total,
      digest,
      signal: new AbortController().signal,
      fetchImpl,
      onProgress: () => {},
      onDownloaded: () => {}
    })

    assert.deepEqual(harness.ranges, ['bytes=1000-', ''], 'the retry starts without a Range')
    assert.equal(result.bytes, total)
    assert.ok(readFileSync(files.destination).equals(payload))
    harness.rejectFirstRange = false
  })

  it('rejects a bad digest and discards the partial', async () => {
    const files = setup(1_000)

    await assert.rejects(
      downloadFile({
        ...files,
        url: harness.url,
        expectedBytes: total,
        digest: `sha256:${'0'.repeat(64)}`,
        signal: new AbortController().signal,
        fetchImpl,
        onProgress: () => {},
        onDownloaded: () => {}
      }),
      /Checksum verification failed/
    )

    assert.equal(existsSync(files.partialPath), false, 'a poisoned partial must not be resumed')
    assert.equal(existsSync(files.destination), false)
  })
})
