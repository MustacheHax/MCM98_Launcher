import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Accepts a relative path from a manifest or catalog and returns it using the
 * host separator. Absolute paths, drive letters, and parent traversal are
 * rejected so a manifest can never point outside its install directory.
 */
export function safeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null
  }
  if (normalized.includes('\0')) return null
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join(sep)
}

export function resolveInsideRoot(root: string, relativePath: string): string | null {
  const safe = safeRelativePath(relativePath)
  if (!safe) return null
  const full = resolve(root, safe)
  return isInsideRoot(root, full) ? full : null
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const contents = await readFile(path, 'utf8')
  return JSON.parse(contents) as T
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true })
}

/**
 * Sums the size of regular files under a directory. Used to record the real
 * installed footprint instead of the (compressed) download size.
 */
export async function directorySize(root: string, maxEntries = 250_000): Promise<number> {
  let total = 0
  let visited = 0
  const stack = [root]

  while (stack.length > 0) {
    const directory = stack.pop() as string
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      visited += 1
      if (visited > maxEntries) return total
      const path = join(directory, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push(path)
        } else if (entry.isFile()) {
          total += (await stat(path)).size
        }
      } catch {
        // Files can disappear or be unreadable; skip them.
      }
    }
  }

  return total
}
