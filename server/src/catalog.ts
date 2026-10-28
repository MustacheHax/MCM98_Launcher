import { readFileSync } from 'node:fs'
import type { Platform } from '../../shared/types'

export const PLATFORMS: Platform[] = ['win32', 'linux', 'darwin']

export interface PlatformRule {
  asset?: string
  executable?: string
  args?: string[]
}

export interface CatalogProduct {
  id: string
  name: string
  repo: string
  summary: string
  tags: string[]
  featured: boolean
  includePrereleases: boolean
  platforms: Partial<Record<Platform, PlatformRule>>
}

export interface Catalog {
  products: CatalogProduct[]
  sourcePath: string
  loadedAt: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*:).+$/

interface RawCatalog {
  products?: unknown
}

function fail(source: string, messages: string[]): never {
  throw new Error(
    `Invalid catalog at ${source}:\n${messages.map((message) => `  - ${message}`).join('\n')}`
  )
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Reads and validates the release catalog. Validation is strict so a typo in
 * the deployed catalog fails at boot instead of producing a confusing launcher.
 */
export function loadCatalog(sourcePath: string): Catalog {
  let parsed: RawCatalog
  try {
    parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as RawCatalog
  } catch (error) {
    throw new Error(
      `Could not read catalog at ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products)) {
    fail(sourcePath, ['The catalog must be an object with a "products" array.'])
  }

  const products: CatalogProduct[] = []
  const problems: string[] = []
  const seen = new Set<string>()

  parsed.products.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      problems.push(`products[${index}] must be an object.`)
      return
    }

    const item = raw as Record<string, unknown>
    const id = asString(item.id)
    const repo = asString(item.repo)
    const label = id ? `"${id}"` : `products[${index}]`

    if (!id || !ID_PATTERN.test(id)) {
      problems.push(`${label}: id must match ${ID_PATTERN} (lowercase letters, numbers, dashes).`)
    } else if (seen.has(id)) {
      problems.push(`${label}: duplicate product id.`)
    }

    if (!repo || !REPO_PATTERN.test(repo)) {
      problems.push(`${label}: repo must be in "owner/name" form.`)
    }

    const configuredPlatforms: Partial<Record<Platform, PlatformRule>> = {}
    if (item.platforms !== undefined) {
      if (!item.platforms || typeof item.platforms !== 'object' || Array.isArray(item.platforms)) {
        problems.push(`${label}: platforms must be an object keyed by win32, linux, or darwin.`)
      } else {
        for (const [key, rawRule] of Object.entries(item.platforms as Record<string, unknown>)) {
          if (!PLATFORMS.includes(key as Platform)) {
            problems.push(`${label}: unsupported platform "${key}".`)
            continue
          }
          if (!rawRule || typeof rawRule !== 'object') {
            problems.push(`${label}: platforms.${key} must be an object.`)
            continue
          }
          const rule = rawRule as Record<string, unknown>
          const asset = asString(rule.asset)
          const executable = asString(rule.executable)
          if (rule.asset !== undefined && !asset) {
            problems.push(`${label}: platforms.${key}.asset must be a non-empty string.`)
          }
          if (executable && !SAFE_RELATIVE_PATH.test(executable)) {
            problems.push(`${label}: platforms.${key}.executable must be a relative path.`)
          }
          let args: string[] | undefined
          if (rule.args !== undefined) {
            if (!Array.isArray(rule.args) || rule.args.some((arg) => typeof arg !== 'string')) {
              problems.push(`${label}: platforms.${key}.args must be an array of strings.`)
            } else {
              args = rule.args as string[]
            }
          }
          configuredPlatforms[key as Platform] = {
            ...(asset ? { asset } : {}),
            ...(executable ? { executable } : {}),
            ...(args ? { args } : {})
          }
        }
      }
    }

    let tags: string[] = []
    if (item.tags !== undefined) {
      if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) {
        problems.push(`${label}: tags must be an array of strings.`)
      } else {
        tags = (item.tags as string[])
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 8)
      }
    }

    if (!id || !ID_PATTERN.test(id) || !repo || !REPO_PATTERN.test(repo)) {
      return
    }
    if (seen.has(id)) return
    seen.add(id)

    const name = asString(item.name) ?? repo.split('/')[1] ?? id

    products.push({
      id,
      name,
      repo,
      summary: asString(item.summary) ?? '',
      tags,
      featured: item.featured === true,
      includePrereleases: item.includePrereleases === true,
      platforms: configuredPlatforms
    })
  })

  if (problems.length > 0) {
    fail(sourcePath, problems)
  }

  return {
    products,
    sourcePath,
    loadedAt: new Date().toISOString()
  }
}
