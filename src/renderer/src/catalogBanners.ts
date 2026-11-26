import type { ProductEntry } from '../../../shared/types'

export interface CatalogBanners {
  /** The most recently created repository in the catalog. */
  newest: ProductEntry | null
  /** The older repository with the most recently published release. */
  recentlyUpdated: ProductEntry | null
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function repoCreatedAt(product: ProductEntry): number {
  return timestamp(product.repoCreatedAt)
}

function releasePublishedAt(product: ProductEntry): number {
  return timestamp(product.release?.publishedAt)
}

function newestRepoFirst(a: ProductEntry, b: ProductEntry): number {
  return repoCreatedAt(b) - repoCreatedAt(a) || a.id.localeCompare(b.id)
}

/**
 * Newest! tracks the repository itself, so it stays put until another repo is
 * created. Recently Updated ranks every older repository by its latest release,
 * so it changes as soon as any of them publishes.
 */
export function catalogBanners(products: ProductEntry[]): CatalogBanners {
  const newest =
    products.filter((product) => repoCreatedAt(product) > 0).sort(newestRepoFirst)[0] ?? null
  const newestCreatedAt = newest ? repoCreatedAt(newest) : 0

  const recentlyUpdated =
    products
      .filter((product) => product.id !== newest?.id)
      .filter((product) => {
        if (!newest || newestCreatedAt === 0) return true
        const createdAt = repoCreatedAt(product)
        return createdAt === 0 || createdAt < newestCreatedAt
      })
      .filter((product) => releasePublishedAt(product) > 0)
      .sort(
        (a, b) =>
          releasePublishedAt(b) - releasePublishedAt(a) ||
          newestRepoFirst(a, b)
      )[0] ?? null

  return { newest, recentlyUpdated }
}
