import { useMemo } from 'react'
import type { InstallTask } from '@shared/types'
import { useApp } from '../state'
import {
  formatBytes,
  formatSpeed,
  isTerminalPhase,
  phaseLabel,
  taskProgress,
  versionLabel
} from '../utils'
import { PageHeader } from './PageHeader'
import { Icon } from './Icons'
import { EmptyState } from './EmptyState'

export function DownloadsView(): JSX.Element {
  const { tasks, cancelTask, clearFinished, navigate } = useApp()

  const active = useMemo(
    () => tasks.filter((task) => !isTerminalPhase(task.phase)),
    [tasks]
  )
  const finished = useMemo(
    () =>
      tasks
        .filter((task) => isTerminalPhase(task.phase))
        .sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)),
    [tasks]
  )

  return (
    <div className="view downloads-view">
      <PageHeader
        eyebrow="Transfer queue"
        title="Downloads"
        description="Release assets are downloaded, checked against GitHub's checksum, then unpacked into your library."
        actions={
          <button
            className="btn btn-ghost"
            onClick={() => void clearFinished()}
            disabled={finished.length === 0}
          >
            <Icon name="close" size={15} />
            Clear finished
          </button>
        }
      />

      {tasks.length === 0 && (
        <EmptyState
          icon="download"
          title="No transfers yet"
          description="When you install or update something from the catalog, its download and install progress will show up here."
          action={
            <button className="btn btn-primary" onClick={() => navigate('catalog')}>
              <Icon name="catalog" size={15} />
              Browse the catalog
            </button>
          }
        />
      )}

      {active.length > 0 && (
        <section className="download-section">
          <div className="section-heading compact">
            <div>
              <h2>In progress</h2>
              <p>{active.length} active</p>
            </div>
          </div>
          <div className="task-list">
            {active.map((task) => (
              <TaskCard key={task.id} task={task} onCancel={() => void cancelTask(task.id)} />
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section className="download-section">
          <div className="section-heading compact">
            <div>
              <h2>History</h2>
              <p>This session</p>
            </div>
          </div>
          <div className="task-list">
            {finished.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpenLibrary={() => navigate('library')}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function TaskCard({
  task,
  onCancel,
  onOpenLibrary
}: {
  task: InstallTask
  onCancel?: () => void
  onOpenLibrary?: () => void
}): JSX.Element {
  const { openFolder } = useApp()
  const active = !isTerminalPhase(task.phase)
  const indeterminate =
    task.phase === 'extracting' || task.phase === 'finalizing' || task.phase === 'verifying'
  const percent = taskProgress(task)

  const icon =
    task.phase === 'done'
      ? 'check'
      : task.phase === 'error'
        ? 'alert'
        : task.phase === 'cancelled'
          ? 'close'
          : 'download'

  const detail = (() => {
    if (task.phase === 'downloading') {
      return `${formatBytes(task.receivedBytes)} of ${formatBytes(task.totalBytes)}${
        task.speedBytesPerSec > 0 ? ` · ${formatSpeed(task.speedBytesPerSec)}` : ''
      }`
    }
    if (task.phase === 'done') return `${formatBytes(task.totalBytes)} installed`
    if (task.phase === 'error') return 'Install did not finish'
    if (task.phase === 'cancelled') return 'Transfer stopped'
    return task.message ?? phaseLabel(task.phase)
  })()

  return (
    <div className={`task-card task-${task.phase}`}>
      <div className="task-icon">
        <Icon name={icon} size={19} />
      </div>

      <div className="task-body">
        <div className="task-head">
          <strong>{task.name}</strong>
          <span className="mono task-version">{versionLabel(task.version)}</span>
          <span className={`task-phase phase-${task.phase}`}>{phaseLabel(task.phase)}</span>
        </div>
        <div className="task-detail">{detail}</div>
        {active && (
          <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
            <span style={{ width: `${indeterminate ? 100 : percent}%` }} />
          </div>
        )}
        {task.error && <p className="task-error">{task.error}</p>}
      </div>

      <div className="task-actions">
        {active && onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        {task.phase === 'done' && onOpenLibrary && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => void openFolder(task.productId)}>
              <Icon name="folder" size={14} />
              Folder
            </button>
            <button className="btn btn-sm" onClick={onOpenLibrary}>
              Library
            </button>
          </>
        )}
      </div>
    </div>
  )
}
