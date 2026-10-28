import { existsSync } from 'node:fs'
import { chmod, readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import type { Platform } from '@shared/types'
import { resolveInsideRoot, safeRelativePath } from './fs-utils'
import type { Logger } from './logger'

interface Candidate {
  absolutePath: string
  relativePath: string
  kind: 'exe' | 'app' | 'executable'
  depth: number
  baseName: string
}

export interface DetectionResult {
  executable: string | null
  warning: string | null
}

const MAX_WALK_ENTRIES = 25_000
const MAX_DEPTH = 8

const EXCLUDED_EXECUTABLES = [
  /unitycrashhandler/i,
  /crashreportclient/i,
  /crashpad_handler/i,
  /createdump/i,
  /unins\d*/i,
  /uninstall/i,
  /^setup\.exe$/i,
  /^install\.exe$/i,
  /dxsetup/i,
  /vc_?redist/i,
  /ue4prereqsetup/i,
  /notification_helper/i,
  /eac_launcher/i
]

const EXCLUDED_DIRS = new Set([
  '__macosx',
  'node_modules',
  '.git',
  '_commonredist',
  'redist',
  'redistributables',
  'directx',
  'dotnet',
  'mono'
])

const DATA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.ogg',
  '.wav',
  '.mp3',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.wbf',
  '.pck',
  '.pak',
  '.json',
  '.xml',
  '.csv',
  '.md',
  '.txt',
  '.cfg',
  '.ini',
  '.log',
  '.zip',
  '.7z',
  '.so',
  '.dll',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.wasm',
  '.html',
  '.css',
  '.js',
  '.map',
  '.pdb',
  '.ilk'
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRS.has(name.toLowerCase())
}

function scoreCandidate(candidate: Candidate, productTokens: string[], platform: Platform): number {
  let score = 0
  const base = candidate.baseName.toLowerCase()

  if (candidate.kind === 'app' && platform === 'darwin') score += 6
  if (candidate.kind === 'exe' && platform === 'win32') score += 2
  if (candidate.depth === 0) score += 3
  else if (candidate.depth === 1) score += 1

  const hits = productTokens.filter((token) => base.includes(token)).length
  score += hits * 3
  if (productTokens.length > 0 && hits === productTokens.length) score += 4

  if (/\b(game|play|start|launcher)\b/i.test(base)) score += 1
  if (/(crash|report|helper|editor|config|server|dedicated)/i.test(base)) score -= 4
  return score
}

async function walk(
  root: string,
  platform: Platform,
  logger: Logger
): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  let visited = 0

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= MAX_WALK_ENTRIES) return

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (visited >= MAX_WALK_ENTRIES) return
      visited += 1
      const absolutePath = join(directory, entry.name)
      const relativePath = relative(root, absolutePath).split(sep).join('/')

      if (entry.isDirectory()) {
        if (isExcludedDirectory(entry.name)) continue
        if (platform === 'darwin' && entry.name.toLowerCase().endsWith('.app')) {
          candidates.push({
            absolutePath,
            relativePath,
            kind: 'app',
            depth,
            baseName: entry.name
          })
          continue
        }
        await visit(absolutePath, depth + 1)
        continue
      }

      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      const extension = extname(lower)

      if (platform === 'win32') {
        if (extension !== '.exe') continue
        if (EXCLUDED_EXECUTABLES.some((pattern) => pattern.test(entry.name))) continue
        candidates.push({
          absolutePath,
          relativePath,
          kind: 'exe',
          depth,
          baseName: entry.name
        })
        continue
      }

      if (platform === 'linux' || platform === 'darwin') {
        if (DATA_EXTENSIONS.has(extension)) continue
        if (EXCLUDED_EXECUTABLES.some((pattern) => pattern.test(entry.name))) continue

        let executable = false
        try {
          const info = await stat(absolutePath)
          if (!info.isFile() || info.size === 0) continue
          executable = (info.mode & 0o111) !== 0
        } catch {
          continue
        }

        const looksLikeBinary =
          extension === '.x86_64' ||
          extension === '.x86' ||
          lower.endsWith('.appimage') ||
          (extension === '' && !lower.includes('.'))

        if (!executable && !looksLikeBinary && platform === 'linux') continue
        if (!executable && platform === 'darwin') continue

        candidates.push({
          absolutePath,
          relativePath,
          kind: 'executable',
          depth,
          baseName: entry.name
        })
      }
    }
  }

  await visit(root, 0)
  if (visited >= MAX_WALK_ENTRIES) {
    logger.warn(`Executable scan stopped after ${MAX_WALK_ENTRIES} entries.`)
  }
  return candidates
}

async function findInAppBundle(appPath: string): Promise<string | null> {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  try {
    const plist = await readFile(plistPath, 'utf8')
    const match = plist.match(
      /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]+)<\/string>/i
    )
    if (match?.[1]) {
      const executable = join(appPath, 'Contents', 'MacOS', match[1].trim())
      if (existsSync(executable)) return executable
    }
  } catch {
    // Fall through to the MacOS directory scan.
  }

  try {
    const macosDir = join(appPath, 'Contents', 'MacOS')
    const entries = await readdir(macosDir, { withFileTypes: true })
    const executable = entries.find((entry) => entry.isFile())
    if (executable) return join(macosDir, executable.name)
  } catch {
    // Ignore missing bundles.
  }
  return null
}

function findHintedExecutable(
  appDirectory: string,
  hint: string
): string | null {
  const relativeHint = safeRelativePath(hint)
  if (!relativeHint) return null
  const direct = resolveInsideRoot(appDirectory, relativeHint)
  if (direct && existsSync(direct)) return direct
  return null
}

/**
 * Chooses the most likely runnable file in an extracted build. A catalog hint
 * wins when present; otherwise names and layout are scored. Returns a path
 * relative to the app directory.
 */
export async function detectExecutable(
  appDirectory: string,
  platform: Platform,
  productName: string,
  hint: string | null,
  logger: Logger
): Promise<DetectionResult> {
  if (hint) {
    const hinted = findHintedExecutable(appDirectory, hint)
    if (hinted) {
      const relativePath = relative(appDirectory, hinted).split(sep).join('/')
      logger.info(`Using configured executable: ${relativePath}`)
      return { executable: relativePath, warning: null }
    }
    logger.warn(`Configured executable "${hint}" was not found; falling back to detection.`)
  }

  const candidates = await walk(appDirectory, platform, logger)
  if (candidates.length === 0) {
    return {
      executable: null,
      warning:
        'No runnable executable was found in this build. Add platforms.' +
        `${platform}.executable to the catalog entry and republish the release.`
    }
  }

  const productTokens = tokenize(productName)
  if (hint) {
    const wanted = basename(hint.replace(/\\/g, '/')).toLowerCase()
    const exact = candidates.find((candidate) => candidate.baseName.toLowerCase() === wanted)
    if (exact) {
      logger.info(`Matched configured executable by name: ${exact.relativePath}`)
      return { executable: exact.relativePath, warning: null }
    }
  }

  const ranked = [...candidates].sort((a, b) => {
    const scoreDiff =
      scoreCandidate(b, productTokens, platform) - scoreCandidate(a, productTokens, platform)
    if (scoreDiff !== 0) return scoreDiff
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.relativePath.localeCompare(b.relativePath)
  })

  const best = ranked[0] as Candidate
  logger.info(
    `Detected executable ${best.relativePath} (from ${candidates.length} candidate(s)).`
  )

  if (best.kind === 'app') {
    const inner = await findInAppBundle(best.absolutePath)
    if (!inner) {
      return {
        executable: null,
        warning:
          'Found a macOS app bundle but could not resolve its executable. Set the executable path in the catalog.'
      }
    }
    const relativePath = relative(appDirectory, inner).split(sep).join('/')
    logger.info(`Using app bundle executable: ${relativePath}`)
    return { executable: relativePath, warning: null }
  }

  if (platform !== 'win32') {
    try {
      const info = await stat(best.absolutePath)
      if ((info.mode & 0o111) === 0) await chmod(best.absolutePath, info.mode | 0o111)
    } catch (error) {
      logger.warn(`Could not mark ${best.relativePath} executable:`, error)
    }
  }

  return { executable: best.relativePath, warning: null }
}
