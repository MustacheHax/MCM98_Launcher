import { minimatch } from 'minimatch'
import type {
  AssetInfo,
  InstallHint,
  Platform,
  ProductEntry,
  ReleaseInfo
} from '../../shared/types'
import { PLATFORMS, type CatalogProduct } from './catalog'
import {
  getRepoSnapshot,
  type GitHubAsset,
  type GitHubRelease,
  type GitHubRepo
} from './github'

const ARCHIVE_PATTERN = /\.(zip|tar\.gz|tgz)$/i
const AUXILIARY_ASSET_PATTERN =
  /(chromedriver|ffmpeg|mksnapshot|xcache|symbols?|debug|breakpad|libcxx|headers|pdb|dsym|toolchain|snapshot|shasums|hunspell|dictionaries|api\.json|node\.lib)/i

const PLATFORM_LABEL: Record<Platform, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS'
}

const PLATFORM_HINTS: Record<Platform, RegExp> = {
  win32: /(?:^|[^a-z])win(?:32|64|dows)?(?:[^a-z]|$)/i,
  linux: /(?:^|[^a-z])(?:linux|ubuntu|x86_64|amd64)(?:[^a-z]|$)/i,
  darwin: /(?:^|[^a-z])(?:mac|macos|osx|darwin|apple)(?:[^a-z]|$)/i
}

const ARCHIVE_PREFERENCE: Record<Platform, RegExp[]> = {
  win32: [/\.zip$/i, /\.tar\.gz$/i, /\.tgz$/i],
  linux: [/\.tar\.gz$/i, /\.tgz$/i, /\.zip$/i],
  darwin: [/\.zip$/i, /\.tar\.gz$/i, /\.tgz$/i]
}

interface AssetPick {
  asset: GitHubAsset | null
  error: string | null
}

export interface ResolvedProduct {
  entry: ProductEntry
  release: GitHubRelease | null
  asset: GitHubAsset | null
  repo: GitHubRepo | null
}

function isArchive(asset: GitHubAsset): boolean {
  return ARCHIVE_PATTERN.test(asset.name)
}

function matchesPlatform(asset: GitHubAsset, platform: Platform): boolean {
  return PLATFORM_HINTS[platform].test(asset.name)
}

function hasOtherPlatformHint(asset: GitHubAsset, platform: Platform): boolean {
  return PLATFORMS.some((item) => item !== platform && PLATFORM_HINTS[item].test(asset.name))
}

function productTokens(product: CatalogProduct): string[] {
  return `${product.id} ${product.name}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

function scoreAsset(asset: GitHubAsset, platform: Platform, product: CatalogProduct): number {
  const name = asset.name.toLowerCase()
  let score = 0

  if (AUXILIARY_ASSET_PATTERN.test(asset.name)) score -= 50
  else score += 10

  const repoName = product.repo.split('/')[1]?.toLowerCase()
  if (repoName && name.includes(repoName)) score += 8

  const tokens = productTokens(product)
  const hits = tokens.filter((token) => name.includes(token)).length
  score += Math.min(hits, 4) * 2

  const preferenceIndex = ARCHIVE_PREFERENCE[platform].findIndex((pattern) =>
    pattern.test(asset.name)
  )
  if (preferenceIndex === 0) score += 2
  else if (preferenceIndex > 0) score += 1

  return score
}

/**
 * Chooses the most useful archive from a set: the actual build over checksum,
 * symbols, or tooling assets, then the platform's preferred archive type.
 */
function preferArchive(
  assets: GitHubAsset[],
  platform: Platform,
  product: CatalogProduct
): GitHubAsset {
  return assets
    .slice()
    .sort((a, b) => {
      const scoreDiff = scoreAsset(b, platform, product) - scoreAsset(a, platform, product)
      if (scoreDiff !== 0) return scoreDiff
      if (a.name.length !== b.name.length) return a.name.length - b.name.length
      return a.name.localeCompare(b.name)
    })[0] as GitHubAsset
}

/**
 * Picks the asset for a platform. A configured glob wins; otherwise the asset
 * name is inspected for platform hints. When a release ships a single unnamed
 * archive it is treated as universal.
 */
function selectAsset(release: GitHubRelease, product: CatalogProduct, platform: Platform): AssetPick {
  const rule = product.platforms[platform]

  if (rule?.asset) {
    const matches = release.assets.filter((asset) =>
      minimatch(asset.name, rule.asset as string, { nocase: true })
    )
    if (matches.length === 0) {
      return {
        asset: null,
        error: `No asset matched "${rule.asset}" in release ${release.tag_name}.`
      }
    }
    const archive = matches.find(isArchive)
    if (!archive) {
      return {
        asset: null,
        error: `The configured asset is not a supported archive (.zip, .tar.gz, .tgz).`
      }
    }
    return { asset: preferArchive(matches.filter(isArchive), platform, product), error: null }
  }

  const archives = release.assets.filter(isArchive)
  if (archives.length === 0) {
    return {
      asset: null,
      error: `Release ${release.tag_name} has no installable archive (.zip, .tar.gz, .tgz).`
    }
  }

  const hinted = archives.filter(
    (asset) => matchesPlatform(asset, platform) && !hasOtherPlatformHint(asset, platform)
  )
  if (hinted.length > 0) {
    return { asset: preferArchive(hinted, platform, product), error: null }
  }

  const unhinted = archives.filter(
    (asset) => !PLATFORMS.some((item) => PLATFORM_HINTS[item].test(asset.name))
  )
  if (unhinted.length > 0 && unhinted.length === archives.length) {
    return { asset: preferArchive(unhinted, platform, product), error: null }
  }

  return {
    asset: null,
    error: `The latest release has no ${PLATFORM_LABEL[platform]} build.`
  }
}

function fallbackName(product: CatalogProduct, repo: GitHubRepo | null): string {
  if (product.name) return product.name
  if (repo?.name) return repo.name
  return product.id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function availablePlatforms(
  release: GitHubRelease,
  product: CatalogProduct
): Platform[] {
  const configured = Object.keys(product.platforms) as Platform[]
  const candidates = configured.length > 0 ? configured : PLATFORMS
  return candidates.filter((platform) => selectAsset(release, product, platform).asset !== null)
}

function toAssetInfo(
  productId: string,
  platform: Platform,
  asset: GitHubAsset,
  viaRelay: boolean,
  baseUrl: string
): AssetInfo {
  const relayUrl = new URL(`/api/download/${encodeURIComponent(productId)}`, baseUrl)
  relayUrl.searchParams.set('platform', platform)
  return {
    name: asset.name,
    size: asset.size,
    digest: asset.digest ?? null,
    downloadUrl: viaRelay ? relayUrl.toString() : asset.browser_download_url,
    viaRelay
  }
}

function toReleaseInfo(
  release: GitHubRelease,
  asset: AssetInfo
): ReleaseInfo {
  return {
    tag: release.tag_name,
    name: release.name?.trim() || release.tag_name,
    publishedAt: release.published_at,
    prerelease: release.prerelease,
    url: release.html_url,
    notes: release.body ? release.body.slice(0, 20_000) : null,
    asset
  }
}

/**
 * Resolves one catalog entry for a platform, including the raw asset needed by
 * the relay download endpoint.
 */
export async function resolveProduct(
  product: CatalogProduct,
  platform: Platform,
  baseUrl: string
): Promise<ResolvedProduct> {
  const snapshot = await getRepoSnapshot(product.repo, product.includePrereleases)
  const repo = snapshot.repo
  const release = snapshot.release
  const name = fallbackName(product, repo)
  const repoUrl = repo?.html_url ?? `https://github.com/${product.repo}`
  const tags = product.tags.length > 0 ? product.tags : (repo?.topics ?? []).slice(0, 8)
  const summary =
    product.summary ||
    repo?.description?.trim() ||
    (release?.name?.trim() ?? '') ||
    'A release from the MCM98 catalog.'

  const baseEntry: ProductEntry = {
    id: product.id,
    name,
    summary: summary.slice(0, 300),
    repo: product.repo,
    repoUrl,
    tags,
    featured: product.featured,
    status: 'unavailable',
    error: null,
    platform,
    availablePlatforms: [],
    release: null,
    install: null
  }

  if (!release) {
    return {
      entry: {
        ...baseEntry,
        error:
          snapshot.releaseError ??
          'No published release was found for this repository.'
      },
      release: null,
      asset: null,
      repo
    }
  }

  const available = availablePlatforms(release, product)
  const configured = Object.keys(product.platforms).length > 0
  const pick: AssetPick =
    configured && !product.platforms[platform]
      ? {
          asset: null,
          error: `No ${PLATFORM_LABEL[platform]} build is configured for this product.`
        }
      : selectAsset(release, product, platform)

  if (!pick.asset) {
    return {
      entry: {
        ...baseEntry,
        availablePlatforms: available,
        error: pick.error ?? 'No installable build was found.'
      },
      release,
      asset: null,
      repo
    }
  }

  const viaRelay = process.env.FORCE_RELAY === '1' || repo?.private === true
  const assetInfo = toAssetInfo(product.id, platform, pick.asset, viaRelay, baseUrl)
  const install: InstallHint = {
    executable: product.platforms[platform]?.executable ?? null,
    args: product.platforms[platform]?.args ?? []
  }

  return {
    entry: {
      ...baseEntry,
      tags,
      status: 'ready',
      availablePlatforms: available.length > 0 ? available : [platform],
      release: toReleaseInfo(release, assetInfo),
      install
    },
    release,
    asset: pick.asset,
    repo
  }
}
