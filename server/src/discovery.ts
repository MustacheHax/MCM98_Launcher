import type { CatalogProduct } from './catalog'
import { getRepoSnapshot, listOwnerRepos, type GitHubRepo } from './github'
import { launcherRepo } from './launcher'
import { releaseHasInstallableAsset } from './resolver'

/**
 * How long a discovered repository list is reused. New releases inside an
 * already-known repo are picked up by the GitHub snapshot cache instead; this
 * only controls how quickly a brand-new repository appears.
 */
const DISCOVERY_TTL_MS = 120_000
/** Bounds the GitHub burst on accounts with many repositories. */
const SNAPSHOT_CONCURRENCY = 4
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Discovery could not determine the catalog. The relay turns this into a 5xx
 * so the launcher keeps its last-known catalog instead of caching an empty one.
 */
export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

/**
 * Accounts whose repositories are discovered automatically. Defaults to the
 * launcher's own account, so a personal relay needs no extra configuration;
 * set `CATALOG_OWNERS=none` to disable discovery and serve only manual entries.
 */
export function catalogOwners(raw: string | undefined = process.env.CATALOG_OWNERS): string[] {
  const configured = raw === undefined ? (launcherRepo().split('/')[0] ?? '') : raw
  if (!configured || configured.trim().toLowerCase() === 'none') return []
  return [
    ...new Set(
      configured
        .split(',')
        .map((owner) => owner.trim())
        .filter((owner) => OWNER_PATTERN.test(owner))
    )
  ].slice(0, 5)
}

/** Repository name to a valid catalog id (`lands-of-the-lost`). */
export function autoProductId(repoName: string): string {
  let id = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (!id) id = 'product'
  if (!/^[a-z0-9]/.test(id)) id = `product-${id}`
  return ID_PATTERN.test(id) ? id : 'product'
}

/** Repository name to a readable title (`lands-of-the-lost` → Lands Of The Lost). */
export function autoProductName(repoName: string): string {
  const words = repoName.split(/[-_.\s]+/).filter(Boolean)
  if (words.length === 0) return repoName
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function autoProduct(repo: GitHubRepo, usedIds: Set<string>): CatalogProduct {
  const base = autoProductId(repo.name)
  const owner = repo.full_name.split('/')[0] ?? 'owner'
  let id = base
  if (usedIds.has(id)) id = autoProductId(`${owner}-${repo.name}`)
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base.slice(0, 56).replace(/-+$/g, '')}-${suffix++}`
  }
  usedIds.add(id)

  return {
    id,
    name: autoProductName(repo.name),
    repo: repo.full_name,
    summary: repo.description?.trim() ?? '',
    tags: (repo.topics ?? []).filter((tag) => typeof tag === 'string').slice(0, 8),
    featured: false,
    includePrereleases: true,
    platforms: {}
  }
}

/**
 * Manual entries always win: they are the place to pin a display name, summary,
 * tags, or platform asset rules for one of the discovered repositories.
 */
export function mergeProducts(
  manual: CatalogProduct[],
  discovered: CatalogProduct[]
): CatalogProduct[] {
  const repos = new Set(manual.map((product) => product.repo.toLowerCase()))
  const ids = new Set(manual.map((product) => product.id))
  const merged = [...manual]

  for (const product of discovered) {
    const repo = product.repo.toLowerCase()
    if (repos.has(repo) || ids.has(product.id)) continue
    merged.push(product)
    repos.add(repo)
    ids.add(product.id)
  }

  return merged
}

interface DiscoveryCache {
  key: string
  products: CatalogProduct[]
  expiresAt: number
}

let cache: DiscoveryCache | null = null

/**
 * Repositories under the configured accounts that have a published release
 * with a supported build. Private repositories are only visible when the
 * relay's GITHUB_TOKEN can read them.
 */
export async function discoverProducts(manual: CatalogProduct[]): Promise<CatalogProduct[]> {
  const owners = catalogOwners()
  if (owners.length === 0) return []

  const excluded = new Set(manual.map((product) => product.repo.toLowerCase()))
  excluded.add(launcherRepo().toLowerCase())
  const usedIds = new Set(manual.map((product) => product.id))
  const key = `${owners.join(',').toLowerCase()}|${[...excluded].sort().join(',')}`

  if (cache && cache.key === key && cache.expiresAt > Date.now()) {
    return cache.products
  }

  const repos = new Map<string, GitHubRepo>()
  const ownerErrors: string[] = []
  for (const owner of owners) {
    try {
      for (const repo of await listOwnerRepos(owner)) {
        const fullName = repo.full_name.toLowerCase()
        if (excluded.has(fullName)) continue
        if (repo.archived || repo.disabled || repo.fork) continue
        repos.set(fullName, repo)
      }
    } catch (error) {
      ownerErrors.push(`${owner}: ${describe(error)}`)
      console.warn(`[discovery] could not list ${owner}: ${describe(error)}`)
    }
  }

  const candidates = [...repos.values()]
  const products: CatalogProduct[] = []
  let snapshotFailures = 0

  for (let index = 0; index < candidates.length; index += SNAPSHOT_CONCURRENCY) {
    const batch = candidates.slice(index, index + SNAPSHOT_CONCURRENCY)
    const resolved = await Promise.all(
      batch.map(async (repo) => {
        try {
          const snapshot = await getRepoSnapshot(repo.full_name, true)
          if (!snapshot.release) {
            // A repository with no releases is a valid empty result. A repo or
            // network error is not: it means the repository list is incomplete.
            if (!snapshot.releaseMissing || snapshot.repoError) snapshotFailures += 1
            return null
          }
          if (!releaseHasInstallableAsset(snapshot.release)) return null
          return autoProduct(repo, usedIds)
        } catch (error) {
          snapshotFailures += 1
          console.warn(`[discovery] skipped ${repo.full_name}: ${describe(error)}`)
          return null
        }
      })
    )
    for (const product of resolved) {
      if (product) products.push(product)
    }
  }

  if (ownerErrors.length > 0 || snapshotFailures > 0) {
    const details = [...ownerErrors]
    if (snapshotFailures > 0) {
      details.push(
        `${snapshotFailures} of ${candidates.length} repositories could not be resolved`
      )
    }
    throw new DiscoveryError(`The relay could not refresh the catalog: ${details.join('; ')}`)
  }

  cache = { key, products, expiresAt: Date.now() + DISCOVERY_TTL_MS }
  if (products.length > 0) {
    console.info(
      `[discovery] ${products.length} product(s) from ${owners.join(', ')}: ${products
        .map((product) => product.id)
        .join(', ')}`
    )
  }
  return products
}

/** The manual catalog plus everything discovered for the configured accounts. */
export async function catalogWithDiscovered(
  manual: CatalogProduct[]
): Promise<CatalogProduct[]> {
  return mergeProducts(manual, await discoverProducts(manual))
}
