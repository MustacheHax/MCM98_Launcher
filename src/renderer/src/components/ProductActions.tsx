import type { ProductEntry } from '@shared/types'
import { useApp } from '../state'
import {
  activeTaskFor,
  findInstalled,
  isUpdateAvailable,
  phaseLabel,
  taskProgress
} from '../utils'
import { Icon } from './Icons'

interface ProductActionsProps {
  product: ProductEntry
  size?: 'sm' | 'md'
}

export function ProductActions({ product, size = 'sm' }: ProductActionsProps): JSX.Element {
  const { library, tasks, running, install, launch, busyProductId, navigate } = useApp()
  const installed = findInstalled(library, product.id)
  const task = activeTaskFor(tasks, product.id)
  const isRunning = running.includes(product.id)
  const updateAvailable = Boolean(
    installed && product.release && isUpdateAvailable(installed.version, product.release.tag)
  )
  const busy = busyProductId === product.id
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
            onClick={() => void launch(installed.id)}
            disabled={busy}
          >
            <Icon name="play" size={14} />
            {busy ? 'Starting…' : 'Play'}
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
