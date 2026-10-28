import type { LauncherUpdateInfo } from '@shared/types'
import { formatBytes, formatDate, formatSpeed, isVersionLike, launcherReleaseLabel } from '../utils'
import { Icon } from './Icons'

interface LauncherUpdateBannerProps {
  update: LauncherUpdateInfo
  onDismiss: () => void
  onDownload: () => void
  onInstall: () => void
}

export function LauncherUpdateBanner({
  update,
  onDismiss,
  onDownload,
  onInstall
}: LauncherUpdateBannerProps): JSX.Element {
  const latest = launcherReleaseLabel(update.latestVersion, update.releaseName)
  const titled = isVersionLike(update.latestVersion)
    ? `Launcher ${latest} is available`
    : update.releaseName
      ? `${latest} is available`
      : 'A new launcher build is available'
  const progress = update.progress
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : 0
  const busy = progress.phase === 'downloading' || progress.phase === 'verifying'
  const installing = progress.phase === 'installing'
  const ready = progress.phase === 'ready'

  const detail = (() => {
    if (progress.phase === 'downloading') {
      const speed = progress.speedBytesPerSec > 0 ? ` · ${formatSpeed(progress.speedBytesPerSec)}` : ''
      return `Downloading ${percent}%${speed}`
    }
    if (progress.phase === 'verifying') return 'Verifying the download…'
    if (progress.phase === 'ready') return 'Downloaded. Restart the launcher to finish updating.'
    if (progress.phase === 'installing') return 'Closing the launcher and applying the update…'
    if (progress.phase === 'error') return progress.error ?? 'The update could not be installed.'
    const parts = [
      `You are on v${update.currentVersion}.`,
      update.publishedAt ? `Published ${formatDate(update.publishedAt)}.` : null,
      update.assetName
        ? `${update.assetName}${update.assetSize ? ` · ${formatBytes(update.assetSize)}` : ''}.`
        : null
    ].filter(Boolean)
    return parts.join(' ')
  })()

  return (
    <aside className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        <Icon name="spark" size={18} />
      </span>
      <div className="update-banner-copy">
        <div className="update-banner-title">
          <strong>{titled}</strong>
          <span className="update-banner-badge">Update</span>
        </div>
        <p>{detail}</p>
        {(busy || installing) && (
          <div className={`progress ${progress.phase === 'verifying' ? 'indeterminate' : ''}`}>
            <span style={{ width: `${progress.phase === 'downloading' ? percent : 100}%` }} />
          </div>
        )}
      </div>
      <div className="update-banner-actions">
        {ready ? (
          <button className="btn btn-primary btn-sm" onClick={onInstall}>
            <Icon name="refresh" size={13} />
            Restart &amp; install
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={onDownload}
            disabled={busy || installing}
          >
            <Icon name="download" size={13} />
            {progress.phase === 'downloading'
              ? `Downloading ${percent}%`
              : progress.phase === 'verifying'
                ? 'Verifying…'
                : progress.phase === 'installing'
                  ? 'Installing…'
                  : progress.phase === 'error'
                    ? 'Try again'
                    : 'Update now'}
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={onDismiss}
          disabled={busy || installing}
        >
          Dismiss
        </button>
      </div>
    </aside>
  )
}
