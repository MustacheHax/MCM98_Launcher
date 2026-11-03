import { app } from 'electron'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as tar from 'tar'
import type { BackupResult, InstalledProduct, SaveInfo } from '@shared/types'
import { ensureDir, removePath } from './fs-utils'
import type { Logger } from './logger'

/** Folder names games and tools commonly use for player data. */
const INSTALL_SAVE_DIRS = new Set([
  'saves',
  'save',
  'saved',
  'savegame',
  'savegames',
  'save_data',
  'savedata',
  'userdata',
  'user_data',
  'profile',
  'profiles'
])

const MAX_SCAN_ENTRIES = 400
/** Second-level scan budget for publisher folders such as `<root>/<Studio>/<Game>`. */
const MAX_PUBLISHER_ENTRIES = 60
const MAX_BACKUP_BYTES = 4 * 1024 * 1024 * 1024

interface Candidate {
  path: string
  source: NonNullable<SaveInfo['source']>
  score: number
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Product name/id spellings worth matching against folder names. */
function nameVariants(product: InstalledProduct): string[] {
  const variants = new Set<string>()
  for (const value of [product.name, product.id]) {
    const normalized = normalizeName(value)
    if (normalized.length >= 3) variants.add(normalized)
  }
  return [...variants]
}

function nameScore(folderName: string, variants: string[]): number {
  const normalized = normalizeName(folderName)
  if (!normalized) return 0
  let best = 0
  for (const variant of variants) {
    if (normalized === variant) best = Math.max(best, 10)
    else if (normalized.startsWith(variant) || variant.startsWith(normalized)) best = Math.max(best, 6)
    else if (normalized.includes(variant) || variant.includes(normalized)) best = Math.max(best, 3)
  }
  return best
}

async function isNonEmptyDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) return false
    const entries = await readdir(path)
    return entries.length > 0
  } catch {
    return false
  }
}

async function modifiedAt(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

/** Directories inside the install folder that look like player data. */
async function installCandidates(product: InstalledProduct): Promise<Candidate[]> {
  const found: Candidate[] = []
  let entries
  try {
    entries = await readdir(product.appPath, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const lower = entry.name.toLowerCase()
    if (!INSTALL_SAVE_DIRS.has(lower)) continue
    const path = join(product.appPath, entry.name)
    if (!(await isNonEmptyDirectory(path))) continue
    found.push({ path, source: 'install', score: 8 })
  }
  return found
}

function candidateRoots(): Array<{ root: string; source: NonNullable<SaveInfo['source']> }> {
  const roots: Array<{ root: string; source: NonNullable<SaveInfo['source']> }> = []

  const push = (value: string | undefined, source: NonNullable<SaveInfo['source']>): void => {
    if (!value) return
    if (roots.some((item) => item.root === value)) return
    roots.push({ root: value, source })
  }

  try {
    push(app.getPath('documents'), 'documents')
  } catch {
    // The documents folder can be unavailable on trimmed-down systems.
  }

  if (process.platform === 'win32') {
    push(process.env.APPDATA, 'appData')
    push(process.env.LOCALAPPDATA, 'appData')
    // Unity titles write under LocalLow, which sits outside the roaming folder.
    push(join(homedir(), 'AppData', 'LocalLow'), 'appData')
    try {
      push(app.getPath('appData'), 'appData')
    } catch {
      // Ignore a missing roaming folder.
    }
  } else if (process.platform === 'darwin') {
    push(join(homedir(), 'Library', 'Application Support'), 'appData')
  } else {
    push(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'appData')
    push(join(homedir(), '.config'), 'appData')
  }

  return roots
}

/** Scans the platform's user-data folders for a directory named after the product. */
async function rootCandidates(product: InstalledProduct): Promise<Candidate[]> {
  const variants = nameVariants(product)
  if (variants.length === 0) return []

  const found: Candidate[] = []
  for (const { root, source } of candidateRoots()) {
    if (!existsSync(root)) continue

    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    let scanned = 0
    const unmatched: string[] = []
    for (const entry of entries) {
      if (scanned >= MAX_SCAN_ENTRIES) break
      scanned += 1
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const score = nameScore(entry.name, variants)
      if (score === 0) {
        if (unmatched.length < MAX_PUBLISHER_ENTRIES) unmatched.push(entry.name)
        continue
      }

      const path = join(root, entry.name)
      if (!(await isNonEmptyDirectory(path))) continue
      found.push({ path, source, score })
    }

    found.push(...(await publisherCandidates(root, unmatched, variants, source)))
  }
  return found
}

/**
 * Games that nest their data under a studio folder (`<root>/<Studio>/<Game>`,
 * which is also how Unity stores `Company/Product`). A nested match scores one
 * point below a direct match, so an exact top-level folder still wins.
 */
async function publisherCandidates(
  root: string,
  parents: string[],
  variants: string[],
  source: NonNullable<SaveInfo['source']>
): Promise<Candidate[]> {
  const found: Candidate[] = []
  for (const parent of parents) {
    let children
    try {
      children = await readdir(join(root, parent), { withFileTypes: true })
    } catch {
      continue
    }

    let scanned = 0
    for (const child of children) {
      if (scanned >= MAX_PUBLISHER_ENTRIES) break
      scanned += 1
      if (!child.isDirectory() || child.name.startsWith('.')) continue
      const score = nameScore(child.name, variants)
      if (score === 0) continue

      const path = join(root, parent, child.name)
      if (!(await isNonEmptyDirectory(path))) continue
      found.push({ path, source, score: score - 1 })
    }
  }
  return found
}

/**
 * Finds the most plausible save folder for an installed product. Ranking, best
 * first: an exact product-named folder in a user-data location, a save folder
 * inside the install, a nested studio folder, then a fuzzy name match. Ties
 * break toward the most recent write.
 */
export async function detectSaveDirectory(product: InstalledProduct): Promise<SaveInfo> {
  const candidates = [...(await installCandidates(product)), ...(await rootCandidates(product))]
  if (candidates.length === 0) {
    return { path: null, source: null, exists: false }
  }

  let best: { candidate: Candidate; modified: number } | null = null
  for (const candidate of candidates) {
    const modified = await modifiedAt(candidate.path)
    if (
      !best ||
      candidate.score > best.candidate.score ||
      (candidate.score === best.candidate.score && modified > best.modified)
    ) {
      best = { candidate, modified }
    }
  }

  const chosen = best?.candidate
  if (!chosen) return { path: null, source: null, exists: false }
  return { path: chosen.path, source: chosen.source, exists: true }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * Archives the detected save folder into the launcher's data folder. Backups
 * are plain `.tar.gz`, so they can be restored with any archive tool.
 */
export async function backupSaves(
  product: InstalledProduct,
  dataRoot: string,
  log: Logger
): Promise<BackupResult> {
  const info = await detectSaveDirectory(product)
  if (!info.path) {
    throw new Error(
      'No save folder was detected for this product. Use Open folder to inspect the install first.'
    )
  }

  const folder = basename(info.path)
  const backupDir = join(dataRoot, 'backups')
  await ensureDir(backupDir)
  const file = join(backupDir, `${product.id}-saves-${timestamp()}.tar.gz`)

  log.info(`Backing up saves for ${product.id} from ${info.path}.`)
  await tar.c({ gzip: true, file, cwd: dirname(info.path) }, [folder])

  const size = await stat(file).catch(() => null)
  if (!size?.size) {
    await removePath(file).catch(() => undefined)
    throw new Error('The save backup was empty, so it was discarded.')
  }
  if (size.size > MAX_BACKUP_BYTES) {
    log.warn(`Save backup for ${product.id} is unusually large (${size.size} bytes).`)
  }

  return { path: file, bytes: size.size }
}
