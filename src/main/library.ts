import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstalledProduct } from '@shared/types'
import type { ConfigStore } from './config'
import {
  isInsideRoot,
  readJsonFile,
  removePath,
  resolveInsideRoot,
  safeRelativePath,
  writeJsonAtomic
} from './fs-utils'
import type { Logger } from './logger'

export const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface InstallManifest {
  schemaVersion: 1
  productId: string
  name: string
  version: string
  repo: string
  releaseUrl: string
  installedAt: string
  updatedAt: string
  executable: string | null
  args: string[]
  sizeBytes: number
  assetName: string
  digest: string | null
}

export function assertProductId(productId: string): string {
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new Error(`Invalid product id "${productId}".`)
  }
  return productId
}

export function productDirectory(installRoot: string, productId: string): string {
  const dir = join(installRoot, assertProductId(productId))
  if (!isInsideRoot(installRoot, dir) || dir === installRoot) {
    throw new Error('Refusing to use an install folder outside the library.')
  }
  return dir
}

export async function writeManifest(productDir: string, manifest: InstallManifest): Promise<void> {
  await writeJsonAtomic(join(productDir, 'install.json'), manifest)
}

export async function readManifest(productDir: string): Promise<InstallManifest | null> {
  const path = join(productDir, 'install.json')
  if (!existsSync(path)) return null
  try {
    const raw = await readJsonFile<Partial<InstallManifest>>(path)
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.productId !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.version !== 'string' ||
      typeof raw.installedAt !== 'string'
    ) {
      return null
    }
    return {
      schemaVersion: 1,
      productId: raw.productId,
      name: raw.name,
      version: raw.version,
      repo: typeof raw.repo === 'string' ? raw.repo : '',
      releaseUrl: typeof raw.releaseUrl === 'string' ? raw.releaseUrl : '',
      installedAt: raw.installedAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.installedAt,
      executable:
        typeof raw.executable === 'string' && safeRelativePath(raw.executable)
          ? raw.executable.replace(/\\/g, '/')
          : null,
      args: Array.isArray(raw.args) ? raw.args.filter((arg) => typeof arg === 'string') : [],
      sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : 0,
      assetName: typeof raw.assetName === 'string' ? raw.assetName : '',
      digest: typeof raw.digest === 'string' ? raw.digest : null
    }
  } catch {
    return null
  }
}

export class LibraryService {
  constructor(
    private readonly config: ConfigStore,
    private readonly log: Logger
  ) {}

  get root(): string {
    return this.config.get().installRoot
  }

  async list(): Promise<InstalledProduct[]> {
    const root = this.root
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      return []
    }

    const installed: InstalledProduct[] = []
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      if (!PRODUCT_ID_PATTERN.test(entry)) continue
      const product = await this.read(entry)
      if (product) installed.push(product)
    }

    return installed.sort((a, b) => a.name.localeCompare(b.name))
  }

  async read(productId: string): Promise<InstalledProduct | null> {
    if (!PRODUCT_ID_PATTERN.test(productId)) return null
    const installPath = productDirectory(this.root, productId)
    const appPath = join(installPath, 'app')
    if (!existsSync(appPath)) return null

    const manifest = await readManifest(installPath)
    if (!manifest || manifest.productId !== productId) return null

    let executablePath: string | null = null
    if (manifest.executable) {
      const candidate = resolveInsideRoot(appPath, manifest.executable)
      if (candidate && existsSync(candidate)) {
        executablePath = candidate
      }
    }

    const info = await stat(appPath).catch(() => null)
    if (!info?.isDirectory()) return null

    return {
      id: manifest.productId,
      name: manifest.name,
      version: manifest.version,
      repo: manifest.repo,
      releaseUrl: manifest.releaseUrl,
      installedAt: manifest.installedAt,
      updatedAt: manifest.updatedAt,
      executable: manifest.executable,
      args: manifest.args,
      installPath,
      appPath,
      executablePath,
      sizeBytes: manifest.sizeBytes
    }
  }

  async uninstall(productId: string): Promise<void> {
    const dir = productDirectory(this.root, productId)
    if (!existsSync(dir)) {
      throw new Error('That product is not installed.')
    }
    await removePath(dir)
    this.log.info(`Uninstalled ${productId}.`)
  }
}
