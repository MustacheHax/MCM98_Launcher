import { useMemo, useState } from 'react'
import { useApp } from '../state'
import { activeTaskFor, formatBytes, formatDate, isTerminalPhase, playSummary, versionLabel } from '../utils'
import { PageHeader } from './PageHeader'
import { Cover } from './Cover'
import { Icon } from './Icons'
import { EmptyState } from './EmptyState'
import { WhatsNewCard } from './WhatsNewCard'

export function LibraryView(): JSX.Element {
  const {
    library,
    catalog,
    catalogLoading,
    refreshCatalog,
    navigate,
    launch,
    install,
    requestUninstall,
    openFolder,
    openProduct,
    running,
    tasks,
    busyProductId,
    playState,
    updateAll,
    updateFor,
    repair,
    repairingId
  } = useApp()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'recent' | 'size'>('name')
  const [updatesOnly, setUpdatesOnly] = useState(false)

  const updateMap = useMemo(() => {
    const map = new Map<string, string>()
    if (!catalog) return map
    for (const product of catalog.products) {
      const latest = updateFor(product)
      if (latest) map.set(product.id, latest)
    }
    return map
  }, [catalog, updateFor])

  const totalSize = library.reduce((sum, product) => sum + product.sizeBytes, 0)
  const activeDownloads = tasks.filter((task) => !isTerminalPhase(task.phase)).length

  const lastPlayed = (productId: string): number => {
    const iso = playState[productId]?.lastPlayedAt
    return iso ? Date.parse(iso) || 0 : 0
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = library.filter((product) => {
      if (updatesOnly && !updateMap.has(product.id)) return false
      if (!needle) return true
      return `${product.name} ${product.repo}`.toLowerCase().includes(needle)
    })

    return rows.sort((a, b) => {
      if (sort === 'size') return b.sizeBytes - a.sizeBytes
      if (sort === 'recent') return lastPlayed(b.id) - lastPlayed(a.id)
      return a.name.localeCompare(b.name)
    })
    // lastPlayed reads playState, which is listed below.
  }, [library, query, sort, updatesOnly, updateMap, playState])

  return (
    <div className="view library-view">
      <PageHeader
        eyebrow="Your library"
        title="Installed"
        description="Everything the launcher has downloaded, ready to launch. Updates are pulled from each product's newest GitHub release."
        actions={
          <div className="header-actions">
            <button
              className="btn btn-primary"
              onClick={() => void updateAll()}
              disabled={updateMap.size === 0}
              title="Queue every available product update"
            >
              <Icon name="download" size={15} />
              Update all{updateMap.size > 0 ? ` (${updateMap.size})` : ''}
            </button>
            <button className="btn btn-ghost" onClick={() => void openFolder()}>
              <Icon name="folder" size={15} />
              Install folder
            </button>
            <button
              className="btn"
              onClick={() => void refreshCatalog()}
              disabled={catalogLoading}
            >
              <Icon name="refresh" size={15} className={catalogLoading ? 'spin' : ''} />
              Check product updates
            </button>
          </div>
        }
      />

      <WhatsNewCard />

      {catalog?.stale && (
        <div className="inline-alert" role="status">
          <Icon name="alert" size={16} />
          <span>
            Showing the catalog saved {formatDate(catalog.cachedAt)}. The relay is not answering.
          </span>
          <button className="text-button" onClick={() => void refreshCatalog()}>
            Retry
          </button>
        </div>
      )}

      {library.length > 0 && (
        <div className="library-toolbar">
          <label className="search-box">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your library"
              aria-label="Search library"
            />
          </label>

          <div className="library-toolbar-right">
            <button
              type="button"
              className={`chip chip-filter ${updatesOnly ? 'is-on' : ''}`}
              aria-pressed={updatesOnly}
              onClick={() => setUpdatesOnly((value) => !value)}
            >
              <Icon name="spark" size={12} />
              Updates only
            </button>
            <label className="sort-select">
              <Icon name="sort" size={14} />
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as 'name' | 'recent' | 'size')
                }
                aria-label="Sort library"
              >
                <option value="name">Name</option>
                <option value="recent">Recently played</option>
                <option value="size">Largest first</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {library.length > 0 && (
        <div className="stat-row">
          <div className="stat">
            <span className="stat-icon">
              <Icon name="library" size={17} />
            </span>
            <div>
              <span className="stat-label">Installed</span>
              <strong>{library.length}</strong>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Icon name="download" size={17} />
            </span>
            <div>
              <span className="stat-label">On disk</span>
              <strong>{formatBytes(totalSize)}</strong>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Icon name="spark" size={17} />
            </span>
            <div>
              <span className="stat-label">Updates ready</span>
              <strong>{updateMap.size}</strong>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Icon name="play" size={17} />
            </span>
            <div>
              <span className="stat-label">Active downloads</span>
              <strong>{activeDownloads}</strong>
            </div>
          </div>
        </div>
      )}

      {library.length === 0 ? (
        <EmptyState
          icon="library"
          title="Your library is empty"
          description="Install a game or app from the catalog. Builds are installed into your local library and launched without a browser."
          action={
            <button className="btn btn-primary" onClick={() => navigate('catalog')}>
              <Icon name="catalog" size={15} />
              Browse the catalog
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search"
          title="Nothing matched"
          description={
            updatesOnly && updateMap.size === 0
              ? 'Every installed product is up to date. Clear the filter to see the full library.'
              : `No installed product matches “${query.trim()}”. Try a different search.`
          }
          action={
            <button
              className="btn"
              onClick={() => {
                setQuery('')
                setUpdatesOnly(false)
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="library-list">
          {visible.map((product) => {
            const latest = updateMap.get(product.id)
            const catalogProduct = catalog?.products.find((item) => item.id === product.id)
            const task = activeTaskFor(tasks, product.id)
            const isRunning = running.includes(product.id)
            const busy = busyProductId === product.id

            return (
              <div className="lib-row" key={product.id}>
                <div className="lib-cover">
                  <Cover seed={product.id} title={product.name} silhouette={false} />
                  <span className="lib-cover-letter">{product.name.slice(0, 1)}</span>
                </div>

                <div className="lib-info">
                  <div className="lib-title-line">
                    <button
                      className="lib-title"
                      onClick={() => catalogProduct && openProduct(catalogProduct)}
                      disabled={!catalogProduct}
                      title={catalogProduct ? 'View release details' : product.name}
                    >
                      {product.name}
                    </button>
                    {isRunning && (
                      <span className="chip chip-live">
                        <span className="pulse-dot" />
                        Running
                      </span>
                    )}
                    {latest && !task && <span className="chip chip-accent">Update ready</span>}
                    {task && (
                      <span className="chip chip-task">
                        <Icon name="download" size={12} />
                        {task.message ?? 'Installing'}
                      </span>
                    )}
                  </div>
                  <div className="lib-meta">
                    <span className="mono">{versionLabel(product.version)}</span>
                    <span className="dot-sep" />
                    <span>{product.repo}</span>
                    <span className="dot-sep" />
                    <span>Installed {formatDate(product.installedAt)}</span>
                    <span className="dot-sep" />
                    <span className="mono">{formatBytes(product.sizeBytes)}</span>
                  </div>
                  {playSummary(playState[product.id]) && (
                    <div className="lib-played">
                      <Icon name="clock" size={12} />
                      <span>{playSummary(playState[product.id])}</span>
                    </div>
                  )}
                  <code className="lib-path" title={product.installPath}>
                    {product.installPath}
                  </code>
                </div>

                <div className="lib-actions">
                  {isRunning ? (
                    <span className="running-label">
                      <span className="pulse-dot" />
                      Playing
                    </span>
                  ) : !product.executablePath && catalogProduct ? (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => void repair(catalogProduct)}
                      disabled={busy || repairingId === product.id || Boolean(task)}
                      title="The recorded executable is missing; reinstall this build"
                    >
                      <Icon name="refresh" size={13} />
                      {repairingId === product.id ? 'Repairing…' : 'Repair'}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void launch(product.id)}
                      disabled={busy || Boolean(task)}
                    >
                      <Icon name="play" size={13} />
                      {busy ? 'Starting…' : 'Play'}
                    </button>
                  )}

                  {latest && catalogProduct && !task && !isRunning && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => void install(catalogProduct)}
                      disabled={busy}
                    >
                      Update
                    </button>
                  )}

                  <div className="icon-actions">
                    <button
                      className="icon-button"
                      onClick={() => void openFolder(product.id)}
                      title="Open install folder"
                      aria-label={`Open install folder for ${product.name}`}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                    {catalogProduct && (
                      <button
                        className="icon-button"
                        onClick={() => openProduct(catalogProduct)}
                        title="Release details"
                        aria-label={`View release details for ${product.name}`}
                      >
                        <Icon name="external" size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button danger"
                      onClick={() => requestUninstall(product)}
                      disabled={isRunning || Boolean(task)}
                      title={
                        isRunning
                          ? 'Close the product before uninstalling'
                          : 'Uninstall from this computer'
                      }
                      aria-label={`Uninstall ${product.name}`}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
