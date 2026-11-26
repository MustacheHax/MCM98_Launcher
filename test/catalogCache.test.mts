import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CatalogResponse, ProductEntry } from '../shared/types'
import {
  loadCatalogWithFallback,
  type CachedCatalog,
  type CatalogCacheIo
} from '../src/main/catalogCacheCore'

function product(id: string): ProductEntry {
  return {
    id,
    name: id,
    summary: '',
    repo: `MustacheHax/${id}`,
    repoUrl: `https://github.com/MustacheHax/${id}`,
    tags: [],
    featured: false,
    status: 'ready',
    error: null,
    platform: 'win32',
    availablePlatforms: ['win32'],
    release: {
      tag: 'v1.0.0',
      name: 'v1.0.0',
      publishedAt: '2026-11-25T00:00:00.000Z',
      prerelease: false,
      url: `https://github.com/MustacheHax/${id}/releases/tag/v1.0.0`,
      notes: null,
      asset: {
        name: `${id}.zip`,
        size: 1,
        digest: null,
        downloadUrl: `https://relay.test/download/${id}`,
        viaRelay: true
      }
    },
    install: { executable: null, args: [] }
  }
}

function catalog(products: ProductEntry[]): CatalogResponse {
  return {
    backendVersion: '0.4.9',
    generatedAt: '2026-11-25T00:00:00.000Z',
    platform: 'win32',
    products
  }
}

const SAVED_AT = '2026-11-25T10:00:00.000Z'

function cached(products: ProductEntry[]): CachedCatalog {
  return {
    savedAt: SAVED_AT,
    backendUrl: 'https://relay.test',
    platform: 'win32',
    payload: catalog(products)
  }
}

function io(overrides: Partial<CatalogCacheIo> & Pick<CatalogCacheIo, 'fetchCatalog'>): CatalogCacheIo {
  return {
    backendUrl: 'https://relay.test',
    platform: 'win32',
    readCache: async () => null,
    writeCache: async () => {},
    now: () => new Date('2026-11-26T12:00:00.000Z'),
    warn: () => {},
    ...overrides
  }
}

describe('catalog cache fallback', () => {
  it('uses the last known catalog when discovery fails', async () => {
    const writes: CachedCatalog[] = []
    const warnings: string[] = []

    const result = await loadCatalogWithFallback(
      io({
        fetchCatalog: async () => {
          throw new Error('Relay returned HTTP 502: discovery failed')
        },
        readCache: async () => cached([product('project-lotl')]),
        writeCache: async (value) => {
          writes.push(value)
        },
        warn: (message) => warnings.push(message)
      })
    )

    assert.equal(result.stale, true)
    assert.equal(result.cachedAt, SAVED_AT)
    assert.equal(result.products[0]?.id, 'project-lotl')
    assert.equal(writes.length, 0)
    assert.match(warnings[0] ?? '', /HTTP 502/)
  })

  it('surfaces the error when there is no saved catalog', async () => {
    await assert.rejects(
      loadCatalogWithFallback(
        io({
          fetchCatalog: async () => {
            throw new Error('Relay returned HTTP 502: discovery failed')
          }
        })
      ),
      /discovery failed/
    )
  })

  it('keeps the saved catalog when the relay answers with an empty list', async () => {
    const result = await loadCatalogWithFallback(
      io({
        fetchCatalog: async () => catalog([]),
        readCache: async () => cached([product('project-lotl')])
      })
    )

    assert.equal(result.stale, true)
    assert.equal(result.cachedAt, SAVED_AT)
    assert.equal(result.products.length, 1)
  })

  it('returns and saves a fresh non-empty catalog', async () => {
    const writes: CachedCatalog[] = []

    const result = await loadCatalogWithFallback(
      io({
        fetchCatalog: async () => catalog([product('project-lotl')]),
        writeCache: async (value) => {
          writes.push(value)
        }
      })
    )

    assert.equal(result.stale, false)
    assert.equal(result.cachedAt, '2026-11-26T12:00:00.000Z')
    assert.equal(writes.length, 1)
    assert.equal(writes[0]?.payload.products.length, 1)
  })

  it('does not overwrite the cache with an empty first response', async () => {
    const writes: CachedCatalog[] = []

    const result = await loadCatalogWithFallback(
      io({
        fetchCatalog: async () => catalog([]),
        writeCache: async (value) => {
          writes.push(value)
        }
      })
    )

    assert.equal(result.stale, false)
    assert.equal(result.products.length, 0)
    assert.equal(writes.length, 0)
  })
})
