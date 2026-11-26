import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CatalogResponse, LauncherConfig, Platform } from '@shared/types'
import { loadCatalogWithFallback, type CachedCatalog } from './catalogCacheCore'
import type { Logger } from './logger'
import { fetchCatalog } from './relay'

function cachePath(dataRoot: string, backendUrl: string, platform: Platform): string {
  const key = createHash('sha1').update(`${backendUrl}|${platform}`).digest('hex').slice(0, 16)
  return join(dataRoot, 'cache', `catalog-${key}.json`)
}

async function readCache(path: string, log: Logger): Promise<CachedCatalog | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CachedCatalog>
    if (!parsed || !Array.isArray(parsed.payload?.products) || typeof parsed.savedAt !== 'string') {
      return null
    }
    return {
      savedAt: parsed.savedAt,
      backendUrl: String(parsed.backendUrl ?? ''),
      platform: (parsed.platform ?? 'win32') as Platform,
      payload: parsed.payload as CatalogResponse
    }
  } catch {
    return null
  }
}

async function writeCache(path: string, value: CachedCatalog, log: Logger): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } catch (error) {
    log.warn('Could not save the catalog cache.', error)
  }
}

/**
 * Resolves the catalog, falling back to the last successful response when the
 * relay is unreachable. Render's free tier sleeps, and a sleeping relay should
 * not wipe out the update state that the library view depends on.
 */
export async function loadCatalog(
  config: LauncherConfig,
  dataRoot: string,
  platform: Platform,
  log: Logger
): Promise<CatalogResponse> {
  const path = cachePath(dataRoot, config.backendUrl, platform)

  return loadCatalogWithFallback({
    backendUrl: config.backendUrl,
    platform,
    fetchCatalog: () => fetchCatalog(config, platform, log),
    readCache: () => readCache(path, log),
    writeCache: (value) => writeCache(path, value, log),
    now: () => new Date(),
    warn: (message) => log.warn(message)
  })
}
