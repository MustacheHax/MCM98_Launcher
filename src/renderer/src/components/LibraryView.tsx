import { useMemo } from 'react'
import { useApp } from '../state'
import {
  activeTaskFor,
  formatBytes,
  formatDate,
  isUpdateAvailable,
  isTerminalPhase,
  versionLabel
} from '../utils'
import { PageHeader } from './PageHeader'
import { Cover } from './Cover'
import { Icon } from './Icons'
import { EmptyState } from './EmptyState'

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
    busyProductId
  } = useApp()

  const updateMap = useMemo(() => {
    const map = new Map<string, string>()
    if (!catalog) return map
    for (const installed of library) {
      const product = catalog.products.find((item) => item.id === installed.id)
      if (product?.release && isUpdateAvailable(installed.version, product.release.tag)) {
        map.set(installed.id, product.release.tag)
      }
    }
    return map
  }, [catalog, library])

  const totalSize = library.reduce((sum, product) => sum + product.sizeBytes, 0)
  const activeDownloads = tasks.filter((task) => !isTerminalPhase(task.phase)).length

  return (
    <div className="view library-view">
      <PageHeader
        eyebrow="Your library"
        title="Installed"
        description="Everything the launcher has downloaded, ready to launch. Updates are pulled from each product's newest GitHub release."
        actions={
          <div className="header-actions">
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
      ) : (
        <div className="library-list">
          {library.map((product) => {
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
