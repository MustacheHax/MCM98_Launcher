import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CatalogProduct } from '../server/src/catalog'
import {
  autoProductId,
  autoProductName,
  catalogOwners,
  DiscoveryError,
  discoverProducts,
  mergeProducts
} from '../server/src/discovery'

function product(id: string, repo: string): CatalogProduct {
  return {
    id,
    name: id,
    repo,
    summary: '',
    tags: [],
    featured: false,
    includePrereleases: true,
    platforms: {}
  }
}

describe('catalog discovery', () => {
  it('turns a repository name into a catalog id and title', () => {
    assert.equal(autoProductId('lands-of-the-lost'), 'lands-of-the-lost')
    assert.equal(autoProductId('Project LotL!'), 'project-lotl')
    assert.equal(autoProductName('lands-of-the-lost'), 'Lands Of The Lost')
    assert.equal(autoProductName('ProjectFence'), 'ProjectFence')
  })

  it('parses CATALOG_OWNERS and supports disabling discovery', () => {
    assert.deepEqual(catalogOwners('MustacheHax, MustacheHax ,acme'), ['MustacheHax', 'acme'])
    assert.deepEqual(catalogOwners('none'), [])
    assert.deepEqual(catalogOwners(''), [])
  })

  it('lets a manual entry override the same repository', () => {
    const merged = mergeProducts(
      [product('project-lotl', 'MustacheHax/lands-of-the-lost')],
      [
        product('lands-of-the-lost', 'mustachehax/lands-of-the-lost'),
        product('pixelrpg', 'MustacheHax/PixelRPG')
      ]
    )

    assert.deepEqual(
      merged.map((item) => item.id),
      ['project-lotl', 'pixelrpg']
    )
  })

  it('reports a failed discovery instead of an empty catalog', async () => {
    const previous = {
      owners: process.env.CATALOG_OWNERS,
      launcher: process.env.LAUNCHER_REPO,
      token: process.env.GITHUB_TOKEN,
      fetch: globalThis.fetch
    }
    process.env.CATALOG_OWNERS = 'offline-account'
    process.env.LAUNCHER_REPO = 'offline-account/launcher'
    process.env.GITHUB_TOKEN = `github_pat_${'x'.repeat(30)}`
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    try {
      await assert.rejects(
        discoverProducts([]),
        (error: unknown) =>
          error instanceof DiscoveryError && /could not refresh|network down/i.test(error.message)
      )
    } finally {
      if (previous.owners === undefined) delete process.env.CATALOG_OWNERS
      else process.env.CATALOG_OWNERS = previous.owners
      if (previous.launcher === undefined) delete process.env.LAUNCHER_REPO
      else process.env.LAUNCHER_REPO = previous.launcher
      if (previous.token === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previous.token
      globalThis.fetch = previous.fetch
    }
  })
})
