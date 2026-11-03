import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Logger } from '../src/main/logger'
import { PlayStateStore } from '../src/main/playState'

const log = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as Logger

const dir = mkdtempSync(join(tmpdir(), 'mcm98-playstate-'))
const file = join(dir, 'play-state.json')

after(() => rmSync(dir, { recursive: true, force: true }))

/**
 * A PID that no process owns. Killing it raises ESRCH, which is exactly what the
 * store treats as "this session died while the launcher was closed".
 */
const DEAD_PID = 2_147_483_646

describe('PlayStateStore', () => {
  it('keeps a live session across a restart', () => {
    const first = new PlayStateStore(file, log)
    first.markLaunched('hollow-signal', process.pid)

    const second = new PlayStateStore(file, log)
    assert.deepEqual(second.liveIds(), ['hollow-signal'])
    assert.equal(second.getState()['hollow-signal']?.launches, 1)
  })

  it('reaps a session whose process is gone and folds its playtime in', () => {
    const store = new PlayStateStore(file, log)
    store.markLaunched('hollow-signal', DEAD_PID)

    const restarted = new PlayStateStore(file, log)
    assert.deepEqual(restarted.liveIds(), [], 'a dead PID must not stay running')
    const record = restarted.getState()['hollow-signal']
    assert.ok(record, 'history should survive the reap')
    assert.equal(record.playtimeMs >= 0, true)
    assert.ok(record.lastPlayedAt, 'the session end time is stamped')
  })

  it('adds playtime when a session ends normally', async () => {
    const store = new PlayStateStore(file, log)
    store.markLaunched('foundry-tools', process.pid)
    const before = store.getState()['foundry-tools']?.playtimeMs ?? 0

    await new Promise((resolve) => setTimeout(resolve, 60))
    store.markExited('foundry-tools')

    const record = store.getState()['foundry-tools']
    assert.equal(store.liveIds().includes('foundry-tools'), false)
    assert.ok((record?.playtimeMs ?? 0) > before, 'elapsed time is added to playtime')
    assert.equal(record?.launches, 1)
  })

  it('writes valid JSON that a second launch can read', () => {
    const store = new PlayStateStore(file, log)
    store.markLaunched('rusty-engine', process.pid)

    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number
      running: Record<string, { pid: number }>
      history: Record<string, unknown>
    }
    assert.equal(saved.version, 1)
    assert.equal(saved.running['rusty-engine']?.pid, process.pid)
    assert.ok(saved.history['rusty-engine'])

    const reloaded = new PlayStateStore(file, log)
    assert.equal(reloaded.isRunning('rusty-engine'), true)
  })
})
