import type { InstallPhase, InstallTask, InstalledProduct, Platform, ProductEntry } from '@shared/types'

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function versionLabel(version: string): string {
  return `v${normalizeVersion(version)}`
}

function parseVersion(version: string): { main: number[]; pre: string | null } | null {
  const normalized = normalizeVersion(version)
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/)
  if (!match) return null
  return {
    main: [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ?? null
  }
}

/** Returns > 0 when a is newer, < 0 when b is newer, and 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) {
    const leftText = normalizeVersion(a)
    const rightText = normalizeVersion(b)
    return leftText === rightText ? 0 : leftText > rightText ? 1 : -1
  }

  for (let index = 0; index < 3; index += 1) {
    const difference = (left.main[index] ?? 0) - (right.main[index] ?? 0)
    if (difference !== 0) return difference
  }

  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1

  const leftParts = left.pre.split('.')
  const rightParts = right.pre.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart)
      if (difference !== 0) return difference
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }
  return 0
}

export function isUpdateAvailable(installedVersion: string, latestVersion: string | null | undefined): boolean {
  if (!latestVersion) return false
  return compareVersions(latestVersion, installedVersion) > 0
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
