import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { InstalledProduct, ProductEntry } from '../shared/types'
import { findCatalogProduct, findInstalled } from '../src/renderer/src/productMatch'

function product(id: string, repo: string): ProductEntry {
  return {
    id,
    name: id,
    summary: '',
    repo,
    repoUrl: `https://github.com/${repo}`,
    tags: [],
    featured: false,
    status: 'ready',
    error: null,
    platform: 'win32',
    availablePlatforms: ['win32'],
    release: null,
    install: null
  }
}

function installed(id: string, repo: string): InstalledProduct {
  return {
    id,
    name: id,
    version: '1.0.0',
    repo,
    releaseUrl: '',
    installedAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    executable: null,
    args: [],
    installPath: id,
    appPath: id,
    executablePath: null,
    sizeBytes: 0,
    previousVersion: null
  }
}

describe('catalog and installed product matching', () => {
  it('matches a legacy install by repository when the catalog id changed', () => {
    const library = [installed('user-friendly', 'MustacheHax/UserFriendly')]
    const found = findInstalled(library, product('userfriendly', 'MustacheHax/UserFriendly'))
    assert.equal(found?.id, 'user-friendly')
  })

  it('prefers an exact id match over another install of the same repo', () => {
    const library = [
      installed('user-friendly', 'MustacheHax/UserFriendly'),
      installed('userfriendly', 'MustacheHax/UserFriendly')
    ]
    const found = findInstalled(library, product('userfriendly', 'MustacheHax/UserFriendly'))
    assert.equal(found?.id, 'userfriendly')
  })

  it('ignores repository casing and surrounding whitespace', () => {
    const library = [installed('puzzle-bud', ' MustacheHax/PuzzleBud ')]
    const found = findInstalled(library, product('puzzzlebud', 'mustachehax/puzzlebud'))
    assert.equal(found?.id, 'puzzle-bud')
  })

  it('returns undefined when neither id nor repository matches', () => {
    const library = [installed('other', 'MustacheHax/Other')]
    assert.equal(findInstalled(library, product('userfriendly', 'MustacheHax/UserFriendly')), undefined)
  })

  it('finds the catalog entry for an installed legacy id', () => {
    const catalog = [product('userfriendly', 'MustacheHax/UserFriendly')]
    const found = findCatalogProduct(
      catalog,
      installed('user-friendly', 'MustacheHax/UserFriendly')
    )
    assert.equal(found?.id, 'userfriendly')
  })
})
