import { useMemo } from 'react'
import type { ProductEntry } from '@shared/types'
import { useApp } from '../state'
import {
  findInstalled,
  formatBytes,
  formatDate,
  isUpdateAvailable,
  platformLabel,
  productTags,
  versionLabel
} from '../utils'
import { PageHeader } from './PageHeader'
import { Cover } from './Cover'
import { Icon } from './Icons'
import { ProductCard } from './ProductCard'
import { ProductActions } from './ProductActions'
import { EmptyState } from './EmptyState'

export function CatalogView(): JSX.Element {
  const {
    catalog,
    catalogLoading,
    catalogError,
    refreshCatalog,
    search,
    setSearch,
    library,
    tasks,
    running,
    openProduct,
    navigate
  } = useApp()

  const products = catalog?.products ?? []
  const query = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!query) return products
    return products.filter((product) =>
      [product.name, product.summary, product.repo, ...product.tags]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [products, query])

  const featured = useMemo(
    () =>
      products.find(
        (product) => product.featured && product.status === 'ready' && product.release
      ) ?? null,
    [products]
  )

  const showHero = Boolean(featured && !query)
  const gridProducts =
    showHero && featured ? filtered.filter((product) => product.id !== featured.id) : filtered

  return (
    <div className="view catalog-view">
      <PageHeader
        eyebrow="Selected repositories"
        title="Catalog"
        description="Games and apps published from MCM98's GitHub releases. Install once, then the launcher keeps them updated."
        actions={
          <div className="header-actions">
            <label className="search-box">
              <Icon name="search" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search releases"
                aria-label="Search catalog"
              />
            </label>
            <button
              className="btn btn-icon"
              onClick={() => void refreshCatalog()}
              disabled={catalogLoading}
              aria-label="Refresh catalog"
              title="Refresh catalog"
            >
              <Icon name="refresh" size={16} className={catalogLoading ? 'spin' : ''} />
            </button>
          </div>
        }
      />

      {catalogError && catalog && (
        <div className="inline-alert" role="status">
          <Icon name="alert" size={16} />
          <span>Could not refresh the relay: {catalogError}</span>
          <button className="text-button" onClick={() => void refreshCatalog()}>
            Retry
          </button>
        </div>
      )}

      {!catalog && catalogLoading && <CatalogSkeleton />}

      {!catalog && !catalogLoading && catalogError && (
        <div className="panel error-panel">
          <div className="error-mark">
            <Icon name="alert" size={24} />
          </div>
          <h2>The relay is not answering</h2>
          <p>{catalogError}</p>
          <p className="hint">
            Render's free tier can take up to a minute to wake a sleeping service. Retry, or check
            the relay address in Settings.
          </p>
          <div className="error-actions">
            <button className="btn btn-primary" onClick={() => void refreshCatalog()}>
              <Icon name="refresh" size={15} />
              Try again
            </button>
            <button className="btn" onClick={() => navigate('settings')}>
              Relay settings
            </button>
          </div>
        </div>
      )}

      {catalog && products.length === 0 && (
        <EmptyState
          icon="catalog"
          title="No releases published yet"
          description="The relay is connected, but its catalog is empty. Add repositories to the relay's catalog file and redeploy the service."
          action={
            <button className="btn" onClick={() => void refreshCatalog()}>
              <Icon name="refresh" size={15} />
              Refresh
            </button>
          }
        />
      )}

      {catalog && products.length > 0 && (
        <>
          {showHero && featured && <FeaturedHero product={featured} />}

          <div className="section-heading">
            <div>
              <h2>{query ? 'Search results' : 'All releases'}</h2>
              <p>
                {filtered.length} {filtered.length === 1 ? 'release' : 'releases'}
                {query ? ` matching “${search.trim()}”` : ''}
              </p>
            </div>
            <span className="section-platform">
              <Icon name="monitor" size={14} />
              {platformLabel(catalog.platform)}
            </span>
          </div>

          {gridProducts.length === 0 ? (
            <EmptyState
              icon="search"
              title="Nothing matched"
              description={`No releases match “${search.trim()}”. Try a different search.`}
              action={
                <button className="btn" onClick={() => setSearch('')}>
                  Clear search
                </button>
              }
            />
          ) : (
            <div className="product-grid">
              {gridProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FeaturedHero({ product }: { product: ProductEntry }): JSX.Element {
  const { library, openProduct, running, tasks } = useApp()
  const installed = findInstalled(library, product.id)
  const updateAvailable = Boolean(
    installed && product.release && isUpdateAvailable(installed.version, product.release.tag)
  )
  const task = tasks.find(
    (item) => item.productId === product.id && !['done', 'error', 'cancelled'].includes(item.phase)
  )
  const isRunning = running.includes(product.id)

  return (
    <section className="hero">
      <Cover seed={product.id} title={product.name} className="hero-cover" />
      <div className="hero-shade" />
      <div className="hero-content">
        <div className="hero-kicker">
          <Icon name="spark" size={14} />
          Featured release
          {updateAvailable && <span className="hero-update">Update available</span>}
          {isRunning && (
            <span className="hero-running">
              <span className="pulse-dot" />
              Running
            </span>
          )}
        </div>
        <h2>{product.name}</h2>
        <p className="hero-summary">{product.summary}</p>
        <div className="tag-row">
          {productTags(product).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="hero-actions">
          <ProductActions product={product} size="md" />
          <button className="btn btn-ghost" onClick={() => openProduct(product)}>
            View details
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
        {product.release && (
          <div className="hero-meta">
            <span className="mono">{versionLabel(product.release.tag)}</span>
            <span className="dot-sep" />
            <span>{formatBytes(product.release.asset.size)}</span>
            <span className="dot-sep" />
            <span>{platformLabel(product.platform)}</span>
            <span className="dot-sep" />
            <span>{formatDate(product.release.publishedAt)}</span>
            {task && (
              <>
                <span className="dot-sep" />
                <span className="hero-task">Installing now</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function CatalogSkeleton(): JSX.Element {
  return (
    <div className="catalog-skeleton" aria-label="Loading catalog">
      <div className="hero skeleton-block" />
      <div className="section-heading">
        <div>
          <div className="skeleton-line" style={{ width: 120, height: 18 }} />
          <div className="skeleton-line" style={{ width: 180, height: 12, marginTop: 8 }} />
        </div>
      </div>
      <div className="product-grid">
        {[0, 1, 2].map((index) => (
          <div className="product-card skeleton-card" key={index}>
            <div className="skeleton-block skeleton-cover" />
            <div className="skeleton-body">
              <div className="skeleton-line" style={{ width: '82%' }} />
              <div className="skeleton-line" style={{ width: '64%' }} />
              <div className="skeleton-line" style={{ width: '40%' }} />
            </div>
          </div>
        ))}
      </div>
      <p className="loading-note">
        Contacting the relay… if the service is asleep, this can take a moment.
      </p>
    </div>
  )
}
