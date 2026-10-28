import type { LauncherUpdateInfo } from '@shared/types'
import { formatBytes, formatDate } from '../utils'
import { Icon } from './Icons'

interface LauncherUpdateBannerProps {
  update: LauncherUpdateInfo
  onDismiss: () => void
  onViewRelease: () => void
}

export function LauncherUpdateBanner({
  update,
  onDismiss,
  onViewRelease
}: LauncherUpdateBannerProps): JSX.Element {
  const latest = update.latestVersion ? `v${update.latestVersion}` : 'A new build'
  const detail = [
    update.publishedAt ? `Published ${formatDate(update.publishedAt)}` : null,
    update.assetName
      ? `${update.assetName}${update.assetSize ? ` · ${formatBytes(update.assetSize)}` : ''}`
      : null
  ].filter(Boolean)

  return (
    <aside className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        <Icon name="spark" size={18} />
      </span>
      <div className="update-banner-copy">
        <div className="update-banner-title">
          <strong>Launcher {latest} is available</strong>
          <span className="update-banner-badge">Update</span>
        </div>
        <p>
          You are on v{update.currentVersion}.{detail.length > 0 ? ` ${detail.join(' · ')}.` : ''}{' '}
          Release notes are on GitHub.
        </p>
      </div>
      <div className="update-banner-actions">
        {update.releaseUrl && (
          <button className="btn btn-primary btn-sm" onClick={onViewRelease}>
            <Icon name="external" size={13} />
            View release
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  )
}
