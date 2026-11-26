import type { CatalogResponse, Platform } from '../../shared/types'

export interface CachedCatalog {
  savedAt: string
  backendUrl: string
  platform: Platform
  payload: CatalogResponse
}

export interface CatalogCacheIo {
  backendUrl: string
  platform: Platform
  fetchCatalog: () => Promise<CatalogResponse>
  readCache: () => Promise<CachedCatalog | null>
  writeCache: (value: CachedCatalog) => Promise<void>
  now: () => Date
  warn: (message: string) => void
}

function staleResponse(cached: CachedCatalog): CatalogResponse {
  return { ...cached.payload, stale: true, cachedAt: cached.savedAt }
}

/**
 * Resolves the catalog with the last-known fallback. Kept free of Electron and
 * filesystem imports so the fallback itself can be tested in plain Node.
 *
 * A relay error always falls back to a non-empty saved catalog. An empty 200 is
 * treated the same way: discovery returning nothing is more likely a token or
 * GitHub problem than a genuinely empty catalog.
 */
export async function loadCatalogWithFallback(io: CatalogCacheIo): Promise<CatalogResponse> {
  let payload: CatalogResponse

  try {
    payload = await io.fetchCatalog()
  } catch (error) {
    const cached = await io.readCache()
    if (!cached || cached.payload.products.length === 0) throw error

    const reason = error instanceof Error ? error.message : String(error)
    io.warn(
      `Relay unavailable (${reason}); showing the catalog saved ${cached.savedAt}.`
    )
    return staleResponse(cached)
  }

  if (payload.products.length === 0) {
    const cached = await io.readCache()
    if (cached && cached.payload.products.length > 0) {
      io.warn('Relay returned an empty catalog; keeping the last known products.')
      return staleResponse(cached)
    }
    return { ...payload, stale: false }
  }

  const savedAt = io.now().toISOString()
  await io.writeCache({
    savedAt,
    backendUrl: io.backendUrl,
    platform: io.platform,
    payload
  })
  return { ...payload, stale: false, cachedAt: savedAt }
}
