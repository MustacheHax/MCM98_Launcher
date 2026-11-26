import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ProductEntry } from '../shared/types'
import { catalogBanners } from '../src/renderer/src/catalogBanners'

function product(
  id: string,
  repoCreatedAt: string | null,
  releasePublishedAt: string | null
): ProductEntry {
  return {
    id,
    name: id,
    summary: '',
    repo: `MustacheHax/${id}`,
    repoUrl: `https://github.com/MustacheHax/${id}`,
    tags: [],
    featured: false,
    status: releasePublishedAt ? 'ready' : 'unavailable',
    error: null,
    platform: 'win32',
    repoCreatedAt,
    availablePlatforms: releasePublishedAt ? ['win32'] : [],
    release: releasePublishedAt
      ? {
          tag: 'v1.0.0',
          name: 'v1.0.0',
          publishedAt: releasePublishedAt,
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
        }
      : null,
    install: null
  }
}

describe('catalog top banners', () => {
  it('picks the newest repository and the latest release from an older one', () => {
    const banners = catalogBanners([
      product('older-a', '2025-01-10T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
      product('older-b', '2025-06-10T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
      product('newest', '2026-10-10T00:00:00.000Z', '2026-11-24T00:00:00.000Z')
    ])

    assert.equal(banners.newest?.id, 'newest')
    assert.equal(banners.recentlyUpdated?.id, 'older-b')
  })

  it('never uses the newest repository for Recently Updated', () => {
    const banners = catalogBanners([
      product('older', '2025-01-10T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
      product('newest', '2026-10-10T00:00:00.000Z', '2026-11-26T00:00:00.000Z')
    ])

    assert.equal(banners.newest?.id, 'newest')
    assert.equal(banners.recentlyUpdated?.id, 'older')
  })

  it('skips a repository with no installable release for Recently Updated', () => {
    const banners = catalogBanners([
      product('older', '2025-01-10T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
      product('no-release', '2025-06-10T00:00:00.000Z', null),
      product('newest', '2026-10-10T00:00:00.000Z', '2026-11-26T00:00:00.000Z')
    ])

    assert.equal(banners.recentlyUpdated?.id, 'older')
  })

  it('still finds the latest updated product when the relay has no repository dates', () => {
    const banners = catalogBanners([
      product('older-a', null, '2026-11-20T00:00:00.000Z'),
      product('older-b', null, '2026-11-25T00:00:00.000Z')
    ])

    assert.equal(banners.newest, null)
    assert.equal(banners.recentlyUpdated?.id, 'older-b')
  })
})
