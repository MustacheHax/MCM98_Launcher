import { existsSync } from 'node:fs'
import { copyFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import * as tar from 'tar'
import type {
  BackupResult,
  InstalledProduct,
  RestoreSavesResult,
  SaveBackup,
  SaveInfo
} from '@shared/types'
import { safeArchivePath } from './archive'
import { ensureDir, isInsideRoot, removePath } from './fs-utils'
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

/**
 * A place games keep player data, plus where that place came from. Callers
 * build these from the platform's folders; tests pass their own.
 */
export interface SaveRoot {
  path: string
  source: NonNullable<SaveInfo['source']>
}

/** Scans the platform's user-data folders for a directory named after the product. */
async function rootCandidates(product: InstalledProduct, roots: SaveRoot[]): Promise<Candidate[]> {
  const variants = nameVariants(product)
  if (variants.length === 0) return []

  const found: Candidate[] = []
  for (const { path: root, source } of roots) {
    if (!root || !existsSync(root)) continue

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
export async function detectSaveDirectory(
  product: InstalledProduct,
  roots: SaveRoot[]
): Promise<SaveInfo> {
  const candidates = [
    ...(await installCandidates(product)),
    ...(await rootCandidates(product, roots))
  ]
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
  log: Logger,
  roots: SaveRoot[]
): Promise<BackupResult> {
  const info = await detectSaveDirectory(product, roots)
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

/** Backups written for a product, newest first, for the restore picker. */
export async function listSaveBackups(
  productId: string,
  dataRoot: string
): Promise<SaveBackup[]> {
  const folder = join(dataRoot, 'backups')
  const prefix = `${productId}-saves-`
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return []
  }

  const backups: SaveBackup[] = []
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tar.gz')) continue
    const path = join(folder, name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) continue
    backups.push({
      path,
      fileName: name,
      createdAt: new Date(info.mtimeMs).toISOString(),
      bytes: info.size
    })
  }

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function copyTree(
  source: string,
  destination: string
): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0

  const visit = async (from: string, to: string): Promise<void> => {
    await ensureDir(to)
    const entries = await readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      const child = join(from, entry.name)
      const target = join(to, entry.name)
      if (entry.isDirectory()) {
        await visit(child, target)
      } else if (entry.isFile()) {
        await copyFile(child, target)
        files += 1
        bytes += (await stat(child)).size
      }
      // Symlinks and device entries are deliberately ignored: a backup should
      // never be able to point outside the save folder.
    }
  }

  await visit(source, destination)
  return { files, bytes }
}

/**
 * Extracts a saved `.tar.gz` over the product's detected save folder. The
 * archive is unpacked into a launcher-owned staging folder first, so a damaged
 * or hostile archive cannot write outside the save folder directly, and the
 * existing save files are merged over rather than deleted.
 */
export async function restoreSaves(
  product: InstalledProduct,
  dataRoot: string,
  backupPath: string,
  log: Logger,
  roots: SaveRoot[]
): Promise<RestoreSavesResult> {
  const backupsRoot = join(dataRoot, 'backups')
  const target = resolve(backupPath)
  const name = basename(target)
  if (
    !isInsideRoot(backupsRoot, target) ||
    target === resolve(backupsRoot) ||
    !name.startsWith(`${product.id}-saves-`) ||
    !name.endsWith('.tar.gz')
  ) {
    throw new Error('That file is not a save backup for this product.')
  }

  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) throw new Error('That save backup no longer exists.')

  const save = await detectSaveDirectory(product, roots)
  if (!save.path) {
    throw new Error(
      'No save folder was detected for this product. Launch it once so it creates one, then restore the backup.'
    )
  }

  const staging = join(dataRoot, 'saves-restore', `${product.id}-${Date.now()}`)
  await ensureDir(staging)
  let archivedFiles = 0

  try {
    await tar.x({
      file: target,
      cwd: staging,
      preservePaths: false,
      strict: true,
      filter: (entryPath, entry) => {
        if (!safeArchivePath(entryPath)) {
          log.warn(`Skipped unsafe save entry: ${entryPath}`)
          return false
        }
        const kind = 'type' in entry ? entry.type : null
        if (kind !== 'File' && kind !== 'Directory') {
          log.warn(`Skipped non-file save entry: ${entryPath}`)
          return false
        }
        if (kind === 'File') archivedFiles += 1
        return true
      }
    })

    const topLevel = await readdir(staging, { withFileTypes: true })
    const folders = topLevel.filter((entry) => entry.isDirectory())
    if (folders.length !== 1 || topLevel.length !== 1) {
      throw new Error('This backup does not have the expected save-folder layout.')
    }

    const source = join(staging, (folders[0] as { name: string }).name)
    log.info(`Restoring ${product.id} saves from ${name} into ${save.path}.`)
    const copied = await copyTree(source, save.path)
    return {
      path: save.path,
      files: copied.files > 0 ? copied.files : archivedFiles,
      bytes: copied.bytes
    }
  } finally {
    await removePath(staging).catch(() => undefined)
  }
}
