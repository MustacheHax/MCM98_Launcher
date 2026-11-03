import { useEffect, useRef, useState } from 'react'
import type { SaveInfo } from '@shared/types'
import { errorMessage, getLauncher } from '../api'
import { useApp } from '../state'
import {
  activeTaskFor,
  findInstalled,
  formatBytes,
  formatDate,
  phaseLabel,
  platformLabel,
  playSummary,
  productTags,
  releaseVersionLabel,
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
    playState,
    repairingId,
    requestUninstall,
    openFolder,
    navigate,
    toast,
    updateFor,
    isUpdateSkipped,
    skipUpdate,
    unskipUpdate,
    repair
  } = useApp()
  const closeRef = useRef<HTMLButtonElement>(null)
  const bridge = getLauncher()
  const [saves, setSaves] = useState<SaveInfo | null>(null)
  const [savesBusy, setSavesBusy] = useState(false)
  const selectedId = selected?.id

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

  // Save-folder detection touches the disk, so it runs per opened product.
  useEffect(() => {
    let alive = true
    setSaves(null)
    if (!selectedId) return
    void bridge
      .getSaveInfo(selectedId)
      .then((info) => {
        if (alive) setSaves(info)
      })
      .catch(() => {
        if (alive) setSaves({ path: null, source: null, exists: false })
      })
    return () => {
      alive = false
    }
  }, [bridge, selectedId])

  if (!selected) return null

  const installed = findInstalled(library, selected.id)
  const task = activeTaskFor(tasks, selected.id)
  const isRunning = running.includes(selected.id)
  const updateAvailable = Boolean(updateFor(selected))
  const updateSkipped = isUpdateSkipped(selected)
  const repairing = repairingId === selected.id
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

  const openSaves = async (): Promise<void> => {
    try {
      await bridge.openSaveFolder(selected.id)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const makeSaveBackup = async (): Promise<void> => {
    setSavesBusy(true)
    try {
      const result = await bridge.backupSaves(selected.id)
      toast(`Save backup written (${formatBytes(result.bytes)}).`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSavesBusy(false)
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
                {releaseVersionLabel(selected.release)}
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
                {selected.release ? releaseVersionLabel(selected.release) : '—'}
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
                {!installed.executablePath && (
                  <button
                    className="btn btn-outline"
                    onClick={() => void repair(selected)}
                    disabled={Boolean(task) || repairing}
                    title="Reinstall this build to restore a missing executable"
                  >
                    <Icon name="refresh" size={15} />
                    {repairing ? 'Repairing…' : 'Repair install'}
                  </button>
                )}
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
                    <> · {releaseVersionLabel(selected.release)} available</>
                  )}
                </span>
              </div>
              <div className="installed-meta">
                {formatBytes(installed.sizeBytes)} on disk · installed{' '}
                {formatDate(installed.installedAt)}
              </div>
              {playSummary(playState[installed.id]) && (
                <div className="installed-meta">
                  <Icon name="clock" size={12} /> {playSummary(playState[installed.id])}
                </div>
              )}

              {(updateAvailable || updateSkipped) && selected.release && (
                <div className="drawer-update-row">
                  {updateAvailable && (
                    <button className="text-button" onClick={() => void skipUpdate(selected)}>
                      Skip {releaseVersionLabel(selected.release)}
                    </button>
                  )}
                  {updateSkipped && (
                    <button
                      className="text-button"
                      onClick={() => void unskipUpdate(selected.id)}
                    >
                      Skipped {releaseVersionLabel(selected.release)} · Update anyway
                    </button>
                  )}
                </div>
              )}

              <div className="save-row">
                <button
                  className="text-button"
                  onClick={() => void openSaves()}
                  disabled={savesBusy}
                  title={saves?.path ?? 'Look for this product\'s save folder'}
                >
                  <Icon name="folder" size={13} />
                  {saves?.path ? 'Open saves' : 'Find saves'}
                </button>
                <button
                  className="text-button"
                  onClick={() => void makeSaveBackup()}
                  disabled={savesBusy || !saves?.path}
                  title="Archive the save folder into the launcher data folder"
                >
                  <Icon name="download" size={13} />
                  {savesBusy ? 'Backing up…' : 'Back up saves'}
                </button>
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
                    ? `${releaseVersionLabel(selected.release)} · ${formatDate(selected.release.publishedAt)}`
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
