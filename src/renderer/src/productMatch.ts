import type { InstalledProduct, ProductEntry } from '../../../shared/types'

function normalizedRepo(repo: string | undefined): string {
  return (repo ?? '').trim().toLowerCase()
}

/**
 * Catalog ids are derived from repository names, so a discovered product can
 * have a different id than the manifest written by an older catalog entry.
 * Match the id first, then the repository, before declaring it not installed.
 */
export function findInstalled(
  library: InstalledProduct[],
  product: Pick<ProductEntry, 'id' | 'repo'>
): InstalledProduct | undefined {
  const byId = library.find((item) => item.id === product.id)
  if (byId) return byId
  const repo = normalizedRepo(product.repo)
  if (!repo) return undefined
  return library.find((item) => normalizedRepo(item.repo) === repo)
}

/** The catalog entry for an installed product, matching the same id-or-repo rule. */
export function findCatalogProduct(
  products: ProductEntry[],
  installed: Pick<InstalledProduct, 'id' | 'repo'>
): ProductEntry | undefined {
  const byId = products.find((item) => item.id === installed.id)
  if (byId) return byId
  const repo = normalizedRepo(installed.repo)
  if (!repo) return undefined
  return products.find((item) => normalizedRepo(item.repo) === repo)
}
