import type { ProductEntry } from '@shared/types'
import { useApp } from '../state'
import {
  activeTaskFor,
  findInstalled,
  formatBytes,
  isUpdateAvailable,
  platformLabel,
  versionLabel
} from '../utils'
import { Cover } from './Cover'
import { Icon } from './Icons'
import { ProductActions } from './ProductActions'

export function ProductCard({ product }: { product: ProductEntry }): JSX.Element {
  const { library, tasks, running, openProduct } = useApp()
  const installed = findInstalled(library, product.id)
  const task = activeTaskFor(tasks, product.id)
  const isRunning = running.includes(product.id)
  const updateAvailable = Boolean(
    installed && product.release && isUpdateAvailable(installed.version, product.release.tag)
  )
  const primaryTag = product.tags[0]

  return (
    <article
      className={`product-card ${product.status === 'unavailable' ? 'is-unavailable' : ''}`}
      onClick={() => openProduct(product)}
    >
      <div className="card-cover">
        <Cover seed={product.id} title={product.name} />
        <div className="cover-top">
          <span className="chip chip-glass">{primaryTag ? primaryTag.toUpperCase() : 'RELEASE'}</span>
          <div className="cover-badges">
            {installed && (
              <span className="chip chip-solid">
                <Icon name="check" size={12} />
                Installed
              </span>
            )}
            {updateAvailable && <span className="chip chip-accent">Update</span>}
            {isRunning && (
              <span className="chip chip-live">
                <span className="pulse-dot" />
                Running
              </span>
            )}
          </div>
        </div>
        <div className="card-title">
          <span className="card-repo">{product.repo}</span>
          <h3>{product.name}</h3>
        </div>
        {product.release && (
          <span className="card-version">{versionLabel(product.release.tag)}</span>
        )}
      </div>

      <div className="card-body">
        <p className="card-summary">{product.summary}</p>

        {product.status === 'unavailable' && product.error && (
          <p className="card-warning">
            <Icon name="alert" size={14} />
            {product.error}
          </p>
        )}

        <div className="card-meta">
          <span>
            <Icon name="monitor" size={14} />
            {platformLabel(product.platform)}
          </span>
          {product.release && (
            <span className="mono">{formatBytes(product.release.asset.size)}</span>
          )}
          <span className={task ? 'meta-task' : undefined}>
            {task
              ? 'In progress'
              : installed
                ? `Installed ${versionLabel(installed.version)}`
                : product.status === 'ready'
                  ? 'Not installed'
                  : 'No build'}
          </span>
        </div>

        <div className="card-footer">
          <ProductActions product={product} />
          <button
            className="card-details"
            onClick={(event) => {
              event.stopPropagation()
              openProduct(product)
            }}
          >
            Details
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}
