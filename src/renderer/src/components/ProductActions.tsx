import type { ProductEntry } from '@shared/types'
import { useApp } from '../state'
import { activeTaskFor, findInstalled, phaseLabel, taskProgress } from '../utils'
import { Icon } from './Icons'

interface ProductActionsProps {
  product: ProductEntry
  size?: 'sm' | 'md'
}

export function ProductActions({ product, size = 'sm' }: ProductActionsProps): JSX.Element {
  const { library, tasks, running, install, busyProductId, navigate, updateFor, closeProduct } =
    useApp()
  const installed = findInstalled(library, product)
  const activeId = installed?.id ?? product.id
  const task = activeTaskFor(tasks, activeId)
  const isRunning = running.includes(activeId)
  const updateAvailable = Boolean(updateFor(product))
  const busy = busyProductId === activeId
  const sizeClass = size === 'sm' ? 'btn-sm' : ''
  const progress = task ? Math.round(taskProgress(task)) : 0

  const content = (() => {
    if (task) {
      return (
        <button
          className={`btn btn-task ${sizeClass}`}
          onClick={() => navigate('downloads')}
          title={task.message ?? phaseLabel(task.phase)}
        >
          <Icon name="download" size={15} />
          <span>
            {phaseLabel(task.phase)} {task.phase === 'downloading' ? `${progress}%` : ''}
          </span>
        </button>
      )
    }

    if (isRunning) {
      return (
        <button className={`btn btn-running ${sizeClass}`} disabled>
          <span className="pulse-dot" />
          Running
        </button>
      )
    }

    if (installed) {
      return (
        <>
          <button
            className={`btn btn-primary ${sizeClass}`}
            onClick={() => {
              closeProduct()
              navigate('library')
            }}
            title="Open this product in your library"
          >
            <Icon name="library" size={14} />
            Library
          </button>
          {updateAvailable && (
            <button
              className={`btn btn-outline ${sizeClass}`}
              onClick={() => void install(product)}
              disabled={busy}
            >
              Update
            </button>
          )}
        </>
      )
    }

    if (product.status === 'ready' && product.release) {
      return (
        <button
          className={`btn btn-primary ${sizeClass}`}
          onClick={() => void install(product)}
          disabled={busy}
        >
          <Icon name="download" size={15} />
          {busy ? 'Starting…' : 'Install'}
        </button>
      )
    }

    return (
      <button className={`btn btn-ghost ${sizeClass}`} disabled>
        Unavailable
      </button>
    )
  })()

  return (
    <div className="product-actions" onClick={(event) => event.stopPropagation()}>
      {content}
    </div>
  )
}
