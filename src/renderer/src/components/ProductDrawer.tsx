import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProductRelease, SaveBackup, SaveInfo } from '@shared/types'
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
    repair,
    installRelease,
    rollbackProduct
  } = useApp()
  const closeRef = useRef<HTMLButtonElement>(null)
  const bridge = getLauncher()
  const [saves, setSaves] = useState<SaveInfo | null>(null)
  const [savesBusy, setSavesBusy] = useState(false)
  const [releases, setReleases] = useState<ProductRelease[] | null>(null)
  const [releasesError, setReleasesError] = useState<string | null>(null)
  const [pickedTag, setPickedTag] = useState('')
  const [rollbackArmed, setRollbackArmed] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [backups, setBackups] = useState<SaveBackup[] | null>(null)
  const [restorePath, setRestorePath] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
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

  // Release history powers both the patch notes and the version picker.
  useEffect(() => {
    let alive = true
    setReleases(null)
    setReleasesError(null)
    setPickedTag('')
    setRollbackArmed(false)
    setRestoreOpen(false)
    if (!selectedId) return
    void bridge
      .listProductReleases(selectedId)
      .then((response) => {
        if (!alive) return
        setReleases(response.releases)
        setReleasesError(response.error)
        setPickedTag(response.releases[0]?.tag ?? '')
      })
      .catch((error) => {
        if (alive) setReleasesError(errorMessage(error))
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
  const picked = releases?.find((release) => release.tag === pickedTag) ?? releases?.[0] ?? null
  const pickedIsInstalled = Boolean(
    picked && installed && versionLabel(picked.version) === versionLabel(installed.version)
  )
  const pickerBusy = Boolean(task) || isRunning || !picked?.asset || pickedIsInstalled

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

  const openRestore = async (): Promise<void> => {
    setRestoreOpen(true)
    setRestorePath(null)
    setBackups(null)
    try {
      setBackups(await bridge.listSaveBackups(selected.id))
    } catch (error) {
      setBackups([])
      toast(errorMessage(error), 'error')
    }
  }

  const restoreBackup = async (path: string): Promise<void> => {
    setRestoreBusy(true)
    try {
      const result = await bridge.restoreSaves(selected.id, path)
      toast(
        `Restored ${result.files} save file${result.files === 1 ? '' : 's'} (${formatBytes(result.bytes)}).`,
        'success'
      )
      setRestoreOpen(false)
      setRestorePath(null)
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setRestoreBusy(false)
    }
  }

  const doRollback = async (): Promise<void> => {
    setRollbackArmed(false)
    await rollbackProduct(selected.id)
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
                <button className="btn btn-ghost" onClick={() => void openFolder(installed.id)}>
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

              {releases && releases.length > 0 && (
                <div className="version-picker">
                  <label>
                    <span>Install a version</span>
                    <select
                      value={pickedTag}
                      onChange={(event) => setPickedTag(event.target.value)}
                      aria-label="Choose a release version"
                    >
                      {releases.map((release, index) => (
                        <option key={release.tag} value={release.tag}>
                          {releaseVersionLabel(release)}
                          {index === 0 ? ' · latest' : ''}
                          {installed && versionLabel(release.version) === versionLabel(installed.version)
                            ? ' · installed'
                            : ''}
                          {release.asset ? '' : ' · no build'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => picked && void installRelease(selected, picked)}
                    disabled={pickerBusy}
                    title={
                      picked?.asset
                        ? `Download and install ${releaseVersionLabel(picked)}`
                        : 'This release has no build for your platform'
                    }
                  >
                    <Icon name="download" size={13} />
                    {pickedIsInstalled
                      ? 'Installed'
                      : picked
                        ? `Install ${releaseVersionLabel(picked)}`
                        : 'Install'}
                  </button>
                </div>
              )}

              {installed.previousVersion && (
                <div className="rollback-row">
                  <span className="installed-meta">
                    Previous build kept:{' '}
                    <span className="mono">{versionLabel(installed.previousVersion)}</span>
                  </span>
                  {rollbackArmed ? (
                    <span className="inline-confirm">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => void doRollback()}
                        disabled={Boolean(task) || isRunning}
                      >
                        <Icon name="refresh" size={12} />
                        Confirm rollback
                      </button>
                      <button className="text-button" onClick={() => setRollbackArmed(false)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setRollbackArmed(true)}
                      disabled={Boolean(task) || isRunning}
                      title={
                        isRunning
                          ? 'Close the product before rolling back'
                          : 'Switch back to the build this update replaced'
                      }
                    >
                      <Icon name="refresh" size={12} />
                      Roll back
                    </button>
                  )}
                </div>
              )}

              <div className="save-row">
                <button
                  className="text-button"
                  onClick={() => void openSaves()}
                  disabled={savesBusy}
                  title={saves?.path ?? "Look for this product's save folder"}
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
                <button
                  className="text-button"
                  onClick={() => void openRestore()}
                  disabled={savesBusy || Boolean(task) || isRunning}
                  title="Restore a save archive written by this launcher"
                >
                  <Icon name="refresh" size={13} />
                  Restore backup
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
                  {releases && releases.length > 0
                    ? `${releases.length} releases · ${releaseVersionLabel(releases[0] as ProductRelease)} is newest`
                    : 'Newest release first'}
                </p>
              </div>
              <button className="text-button" onClick={() => void openLink(link)}>
                GitHub
                <Icon name="external" size={13} />
              </button>
            </div>

            {releases === null && !releasesError && (
              <p className="notes-loading">Loading release history…</p>
            )}

            {releases && releases.length > 0 ? (
              <div className="release-list">
                {releases.map((release, index) => (
                  <details className="release-entry" key={release.tag} open={index === 0}>
                    <summary>
                      <span className="release-version mono">
                        {releaseVersionLabel(release)}
                      </span>
                      {index === 0 && <span className="chip chip-accent">Newest</span>}
                      {release.prerelease && <span className="chip">Prerelease</span>}
                      <span className="release-date">{formatDate(release.publishedAt)}</span>
                    </summary>
                    <div className="release-body">
                      <div className="notes">
                        {release.notes?.trim() ||
                          'No release notes were published for this release.'}
                      </div>
                      <div className="release-actions">
                        {release.asset && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => void installRelease(selected, release)}
                            disabled={
                              Boolean(task) ||
                              isRunning ||
                              (installed
                                ? versionLabel(release.version) === versionLabel(installed.version)
                                : false)
                            }
                          >
                            <Icon name="download" size={13} />
                            Install {releaseVersionLabel(release)}
                          </button>
                        )}
                        {!release.asset && release.error && (
                          <span className="release-unavailable">{release.error}</span>
                        )}
                        <button className="text-button" onClick={() => void openLink(release.url)}>
                          View on GitHub
                          <Icon name="external" size={12} />
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="notes">
                {selected.release?.notes?.trim() ||
                  releasesError ||
                  selected.error ||
                  'No release notes were published for this release.'}
              </div>
            )}
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

        {restoreOpen &&
          createPortal(
          <div
            className="modal-scrim"
            role="presentation"
            onClick={() => !restoreBusy && setRestoreOpen(false)}
          >
            <div
              className="confirm-modal save-restore-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="restore-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="restore-title">Restore saves</h2>
              <p>
                Choose a backup for <strong>{selected.name}</strong>. Files in
                {saves?.path ? ` ${saves.path}` : ' the detected save folder'} are overwritten.
                Other files are kept.
              </p>

              {backups === null ? (
                <p className="notes-loading">Looking for backups…</p>
              ) : backups.length === 0 ? (
                <p className="settings-note">
                  No save backups exist for this product. Use <strong>Back up saves</strong> first.
                </p>
              ) : (
                <ul className="backup-list">
                  {backups.map((backup) => (
                    <li key={backup.path}>
                      <div className="backup-copy">
                        <strong>{formatDate(backup.createdAt)}</strong>
                        <span>
                          {formatBytes(backup.bytes)} · <span className="mono">{backup.fileName}</span>
                        </span>
                      </div>
                      {restorePath === backup.path ? (
                        <span className="inline-confirm">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void restoreBackup(backup.path)}
                            disabled={restoreBusy}
                          >
                            {restoreBusy ? 'Restoring…' : 'Overwrite saves'}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setRestorePath(null)}
                            disabled={restoreBusy}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setRestorePath(backup.path)}
                          disabled={restoreBusy}
                        >
                          Restore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="confirm-actions">
                <button
                  className="btn"
                  onClick={() => setRestoreOpen(false)}
                  disabled={restoreBusy}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </aside>
    </div>
  )
}
