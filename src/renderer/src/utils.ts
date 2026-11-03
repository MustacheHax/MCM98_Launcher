import { isVersionLike, versionFromRelease, versionLabel } from '@shared/version'
import type {
  InstallPhase,
  InstallTask,
  InstalledProduct,
  Platform,
  PlayRecord,
  ProductEntry
} from '@shared/types'

export {
  compareVersions,
  isUpdateAvailable,
  isVersionLike,
  normalizeVersion,
  versionFromRelease,
  versionLabel
} from '@shared/version'

/**
 * A human label for a launcher release. Release tags are free-form, so when the
 * version is not semantic we fall back to the release title instead of showing
 * something like "vnewest".
 */
export function launcherReleaseLabel(
  latestVersion: string | null,
  releaseName: string | null
): string {
  if (latestVersion && isVersionLike(latestVersion)) return versionLabel(latestVersion)
  return releaseName?.trim() || 'new build'
}

/**
 * The version line shown for a catalog release. A rolling tag such as "newest"
 * would render as "vnewest", so the release title is used instead when no real
 * version can be derived.
 */
export function releaseVersionLabel(release: {
  tag: string
  name?: string | null
  asset?: { name: string } | null
}): string {
  const version = versionFromRelease(release)
  return isVersionLike(version) ? versionLabel(version) : release.name?.trim() || release.tag
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${exponent === 0 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[exponent]}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Compact playtime: "45m", "3h 10m", "2d 4h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** "just now", "12m ago", "3h ago", then a date. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

/** One line of play history for a library row, or null when never launched. */
export function playSummary(record: PlayRecord | undefined): string | null {
  if (!record) return null
  const parts: string[] = []
  if (record.lastPlayedAt) parts.push(`Played ${relativeTime(record.lastPlayedAt)}`)
  if (record.playtimeMs >= 60_000) parts.push(`${formatDuration(record.playtimeMs)} played`)
  if (record.launches > 1 && parts.length > 0) parts.push(`${record.launches} launches`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function platformLabel(platform: Platform): string {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
}

export function shortPlatformLabel(platform: Platform): string {
  return platform === 'win32' ? 'WIN' : platform === 'darwin' ? 'MAC' : 'LINUX'
}

export function findInstalled(library: InstalledProduct[], productId: string): InstalledProduct | undefined {
  return library.find((product) => product.id === productId)
}

const TERMINAL: InstallPhase[] = ['done', 'error', 'cancelled']

export function isTerminalPhase(phase: InstallPhase): boolean {
  return TERMINAL.includes(phase)
}

export function activeTaskFor(tasks: InstallTask[], productId: string): InstallTask | undefined {
  return tasks.find((task) => task.productId === productId && !isTerminalPhase(task.phase))
}

export function taskProgress(task: InstallTask): number {
  if (task.phase === 'queued') return 0
  if (task.phase === 'downloading') {
    return task.totalBytes > 0
      ? Math.min(100, Math.max(0, (task.receivedBytes / task.totalBytes) * 100))
      : 0
  }
  if (task.phase === 'verifying' || task.phase === 'extracting' || task.phase === 'finalizing') {
    return 100
  }
  return 100
}

export function phaseLabel(phase: InstallPhase): string {
  switch (phase) {
    case 'queued':
      return 'Queued'
    case 'downloading':
      return 'Downloading'
    case 'verifying':
      return 'Verifying'
    case 'extracting':
      return 'Extracting'
    case 'finalizing':
      return 'Installing'
    case 'done':
      return 'Installed'
    case 'error':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return phase
  }
}

export function productTags(product: ProductEntry): string[] {
  return product.tags.filter(Boolean).slice(0, 4)
}

export function initials(value: string): string {
  const words = value
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'M'
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase()
  return `${(words[0] as string)[0] ?? ''}${(words[1] as string)[0] ?? ''}`.toUpperCase()
}
