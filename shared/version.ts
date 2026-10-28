/**
 * Small semantic-version helpers shared by the Electron main process and the
 * renderer. Release tags are allowed to omit the leading "v" and minor/patch
 * components.
 */

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function versionLabel(version: string): string {
  return `v${normalizeVersion(version)}`
}

interface ParsedVersion {
  main: number[]
  pre: string | null
}

function parseVersion(version: string): ParsedVersion | null {
  const normalized = normalizeVersion(version)
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/
  )
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

export function isUpdateAvailable(
  installedVersion: string,
  latestVersion: string | null | undefined
): boolean {
  if (!latestVersion) return false
  return compareVersions(latestVersion, installedVersion) > 0
}
