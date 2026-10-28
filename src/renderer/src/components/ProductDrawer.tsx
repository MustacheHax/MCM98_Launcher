import { useEffect, useRef } from 'react'
import { errorMessage, getLauncher } from '../api'
import { useApp } from '../state'
import {
  activeTaskFor,
  findInstalled,
  formatBytes,
  formatDate,
  isUpdateAvailable,
  phaseLabel,
  platformLabel,
  productTags,
  taskProgress,
  versionLabel
} from '../utils'
import { Cover } from './Cover'
import { Icon } from './Icons'
import { ProductActions } from './ProductActions'

export function ProductDrawer(): JSX.Element | null {
  const {
    selected,
    closeProduct,
    library,
    tasks,
    running,
    requestUninstall,
    openFolder,
    navigate,
    toast
  } = useApp()
  const closeRef = useRef<HTMLButtonElement>(null)
  const bridge = getLauncher()

  useEffect(() => {
    closeRef.current?.focus()
    document.body.classList.add('drawer-open')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeProduct()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('drawer-open')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeProduct])

  if (!selected) return null

  const installed = findInstalled(library, selected.id)
  const task = activeTaskFor(tasks, selected.id)
  const isRunning = running.includes(selected.id)
  const updateAvailable = Boolean(
    installed && selected.release && isUpdateAvailable(installed.version, selected.release.tag)
  )
  const percent = task ? Math.round(taskProgress(task)) : 0
  const indeterminate =
    task?.phase === 'extracting' || task?.phase === 'verifying' || task?.phase === 'finalizing'
  const link = selected.release?.url ?? selected.repoUrl

  const openLink = async (url: string): Promise<void> => {
    try {
      await bridge.openExternal(url)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const statusLabel = isRunning
    ? 'Running'
    : installed
      ? updateAvailable
        ? 'Update available'
        : 'Installed'
      : selected.status === 'ready'
        ? 'Ready to install'
        : 'Unavailable'

  return (
    <div className="drawer-layer">
      <div className="drawer-scrim" onClick={closeProduct} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className="drawer-cover">
          <Cover seed={selected.id} title={selected.name} />
          <div className="drawer-cover-shade" />
          <button
            className="drawer-close"
            onClick={closeProduct}
            aria-label="Close details"
            ref={closeRef}
          >
            <Icon name="close" size={18} />
          </button>
          <div className="drawer-cover-copy">
            <span className="card-repo">{selected.repo}</span>
            <h2 id="drawer-title">{selected.name}</h2>
          </div>
        </div>

        <div className="drawer-body">
          <div className="drawer-status-row">
            <span className={`drawer-status ${isRunning ? 'live' : installed ? 'ok' : 'idle'}`}>
              {isRunning && <span className="pulse-dot" />}
              {installed && !isRunning && <Icon name="check" size={13} />}
              {statusLabel}
            </span>
            {selected.release && (
              <span className="drawer-status-version mono">
                {versionLabel(selected.release.tag)}
              </span>
            )}
            {task && (
              <span className="chip chip-task">
                <Icon name="download" size={12} />
                {phaseLabel(task.phase)}
              </span>
            )}
          </div>

          <p className="drawer-summary">{selected.summary}</p>

          <div className="tag-row">
            {productTags(selected).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className="drawer-meta-grid">
            <div>
              <span>Latest</span>
              <strong className="mono">
                {selected.release ? versionLabel(selected.release.tag) : '—'}
              </strong>
            </div>
            <div>
              <span>Download</span>
              <strong>{selected.release ? formatBytes(selected.release.asset.size) : '—'}</strong>
            </div>
            <div>
              <span>Platform</span>
              <strong>{platformLabel(selected.platform)}</strong>
            </div>
            <div>
              <span>Released</span>
              <strong>{formatDate(selected.release?.publishedAt)}</strong>
            </div>
          </div>

          {task && (
            <div className="drawer-task">
              <div className="drawer-task-head">
                <span>
                  {phaseLabel(task.phase)}
                  {task.phase === 'downloading' ? ` · ${percent}%` : ''}
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    closeProduct()
                    navigate('downloads')
                  }}
                >
                  View download
                  <Icon name="chevronRight" size={13} />
                </button>
              </div>
              <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
                <span style={{ width: `${indeterminate ? 100 : percent}%` }} />
              </div>
            </div>
          )}

          {selected.status === 'unavailable' && selected.error && (
            <div className="drawer-error">
              <Icon name="alert" size={16} />
              <p>{selected.error}</p>
            </div>
          )}

          <div className="drawer-actions">
            <ProductActions product={selected} size="md" />
            {installed && (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => void openFolder(installed.id)}
                >
                  <Icon name="folder" size={15} />
                  Open folder
                </button>
                <button
                  className="btn btn-ghost danger-text"
                  onClick={() => requestUninstall(installed)}
                  disabled={isRunning || Boolean(task)}
                  title={
                    isRunning
                      ? 'Close the product before uninstalling'
                      : 'Remove the installed files'
                  }
                >
                  <Icon name="trash" size={15} />
                  Uninstall
                </button>
              </>
            )}
          </div>

          {installed && (
            <div className="installed-card">
              <div className="installed-head">
                <Icon name="check" size={15} />
                <span>
                  Installed {versionLabel(installed.version)}
                  {updateAvailable && selected.release && (
                    <> · {versionLabel(selected.release.tag)} available</>
                  )}
                </span>
              </div>
              <div className="installed-meta">
                {formatBytes(installed.sizeBytes)} on disk · installed{' '}
                {formatDate(installed.installedAt)}
              </div>
              <code className="path" title={installed.installPath}>
                {installed.installPath}
              </code>
            </div>
          )}

          <section className="release-notes">
            <div className="section-heading compact">
              <div>
                <h3>Release notes</h3>
                <p>
                  {selected.release
                    ? `${versionLabel(selected.release.tag)} · ${formatDate(selected.release.publishedAt)}`
                    : 'Nothing published yet'}
                </p>
              </div>
              <button className="text-button" onClick={() => void openLink(link)}>
                GitHub
                <Icon name="external" size={13} />
              </button>
            </div>
            <div className="notes">
              {selected.release?.notes?.trim()
                ? selected.release.notes
                : selected.error ?? 'No release notes were published for this release.'}
            </div>
          </section>

          <div className="availability">
            <span className="avail-label">Available on</span>
            <div className="tag-row">
              {selected.availablePlatforms.length > 0 ? (
                selected.availablePlatforms.map((platform) => (
                  <span className="chip chip-outline" key={platform}>
                    {platformLabel(platform)}
                  </span>
                ))
              ) : (
                <span className="muted">No platform builds</span>
              )}
            </div>
          </div>

          <div className="drawer-links">
            <button className="btn btn-ghost btn-sm" onClick={() => void openLink(selected.repoUrl)}>
              Repository
              <Icon name="external" size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void openLink(link)}>
              Release page
              <Icon name="external" size={13} />
            </button>
            <span className="drawer-relay">
              {selected.release?.asset.viaRelay ? 'Private asset via relay' : 'Direct from GitHub'}
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}
