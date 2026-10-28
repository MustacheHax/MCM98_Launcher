import type { InstallPhase, InstallTask, InstalledProduct, Platform, ProductEntry } from '@shared/types'

export { compareVersions, isUpdateAvailable, normalizeVersion, versionLabel } from '@shared/version'

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
