import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { InstalledProduct } from '../shared/types'
import type { Logger } from '../src/main/logger'
import type { SaveRoot } from '../src/main/saves'
import {
  backupSaves,
  detectSaveDirectory,
  listSaveBackups,
  restoreSaves
} from '../src/main/saves'

const log = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as Logger

const base = mkdtempSync(join(tmpdir(), 'mcm98-saves-'))
after(() => rmSync(base, { recursive: true, force: true }))

/** A directory holding one file, since empty folders are ignored. */
function seed(...segments: string[]): string {
  const path = join(...segments)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'save.dat'), 'progress')
  return path
}

function product(name: string, id: string, appPath: string): InstalledProduct {
  return {
    id,
    name,
    version: '1.0.0',
    repo: 'MCM98/test',
    releaseUrl: '',
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executable: null,
    args: [],
    installPath: join(appPath, '..'),
    appPath,
    executablePath: null,
    sizeBytes: 1,
    previousVersion: null
  }
}

describe('detectSaveDirectory', () => {
  it('finds a folder nested under a publisher', async () => {
    const localAppData = join(base, 'publisher', 'local')
    seed(localAppData, 'Studio Nine', 'Hollow Signal')
    const roots: SaveRoot[] = [{ path: localAppData, source: 'appData' }]

    const found = await detectSaveDirectory(
      product('Hollow Signal', 'hollow-signal', join(base, 'p1', 'app')),
      roots
    )

    assert.equal(found.exists, true)
    assert.equal(found.source, 'appData')
    assert.ok(found.path?.endsWith(join('Studio Nine', 'Hollow Signal')))
  })

  it('prefers a product-named folder over a nested one', async () => {
    const localAppData = join(base, 'prefer', 'local')
    seed(localAppData, 'Studio Nine', 'Hollow Signal')
    const direct = seed(localAppData, 'Hollow Signal')
    const roots: SaveRoot[] = [{ path: localAppData, source: 'appData' }]

    const found = await detectSaveDirectory(
      product('Hollow Signal', 'hollow-signal', join(base, 'p2', 'app')),
      roots
    )

    assert.equal(found.path, direct)
  })

  it('prefers a save folder inside the install over a fuzzy user-data match', async () => {
    const documents = join(base, 'install-win', 'documents')
    seed(documents, 'Rusty Engine Backup')
    const appPath = join(base, 'p3', 'app')
    const inside = seed(appPath, 'saves')
    const roots: SaveRoot[] = [{ path: documents, source: 'documents' }]

    const found = await detectSaveDirectory(product('Rusty Engine', 'rusty-engine', appPath), roots)

    assert.equal(found.source, 'install')
    assert.equal(found.path, inside)
  })

  it('reports nothing when no candidate exists', async () => {
    const roots: SaveRoot[] = [{ path: join(base, 'empty', 'documents'), source: 'documents' }]
    const found = await detectSaveDirectory(
      product('Nothing Here', 'nothing-here', join(base, 'p4', 'app')),
      roots
    )

    assert.equal(found.path, null)
    assert.equal(found.exists, false)
    assert.equal(found.source, null)
  })
})

describe('save backups', () => {
  const dataRoot = join(base, 'restore-data')
  const roots: SaveRoot[] = [{ path: join(base, 'restore', 'local'), source: 'appData' }]
  const savePath = seed(roots[0]?.path as string, 'Hollow Signal')
  const installed = product(
    'Hollow Signal',
    'hollow-signal',
    join(base, 'restore', 'install', 'app')
  )

  it('archives, lists, and restores the detected save folder', async () => {
    const backup = await backupSaves(installed, dataRoot, log, roots)
    const listed = await listSaveBackups('hollow-signal', dataRoot)

    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.path, backup.path)
    assert.ok(listed[0]?.bytes > 0)

    writeFileSync(join(savePath, 'save.dat'), 'newer progress')
    writeFileSync(join(savePath, 'settings.dat'), 'keep me')

    const result = await restoreSaves(installed, dataRoot, backup.path, log, roots)

    // The archived file is restored; a file the backup never contained survives.
    assert.equal(readFileSync(join(savePath, 'save.dat'), 'utf8'), 'progress')
    assert.equal(readFileSync(join(savePath, 'settings.dat'), 'utf8'), 'keep me')
    assert.ok(result.files >= 1)
  })

  it('refuses a file outside the launcher backup folder', async () => {
    const outside = join(base, 'evil.tar.gz')
    writeFileSync(outside, 'not an archive')

    await assert.rejects(
      () => restoreSaves(installed, dataRoot, outside, log, roots),
      /not a save backup/
    )
  })
})
