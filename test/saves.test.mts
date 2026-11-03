import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { InstalledProduct } from '../shared/types'
import type { SaveRoot } from '../src/main/saves'
import { detectSaveDirectory } from '../src/main/saves'

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
    sizeBytes: 1
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
