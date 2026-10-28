import type {
  LauncherReleaseInfo,
  LauncherReleaseResponse,
  Platform
} from '../../shared/types'
import {
  getRepoSnapshot,
  type GitHubAsset,
  type GitHubRelease,
  type GitHubRepo
} from './github'

const DEFAULT_LAUNCHER_REPO = 'MustacheHax/MCM98_Launcher'
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const PLATFORM_LABEL: Record<Platform, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS'
}

/**
 * Launcher builds are installers, not game archives. Prefer the native
 * installer for the platform, then fall back to a portable archive.
 */
const ASSET_PREFERENCE: Record<Platform, RegExp[]> = {
  win32: [
    /win.*(?:x64|amd64).*\.exe$/i,
    /win.*\.exe$/i,
    /win.*(?:x64|amd64).*\.zip$/i,
    /win.*\.zip$/i
  ],
  darwin: [/mac.*(?:arm64|x64|universal).*\.dmg$/i, /mac.*\.dmg$/i, /\.dmg$/i, /mac.*\.zip$/i],
  linux: [/linux.*\.AppImage$/i, /\.AppImage$/i, /linux.*\.tar\.gz$/i, /linux.*\.zip$/i]
}

const IGNORED_ASSETS =
  /(?:blockmap|latest\.ya?ml|\.sha256|\.sha512|\.asc|\.sig|source code)/i

export function launcherRepo(): string {
  const configured = process.env.LAUNCHER_REPO?.trim()
  return configured && REPO_PATTERN.test(configured) ? configured : DEFAULT_LAUNCHER_REPO
}

function versionFromTag(tag: string): string {
  const match = tag.match(/(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/)
  return (match?.[1] ?? tag.replace(/^v/i, '')).trim()
}

function selectLauncherAsset(
  release: GitHubRelease,
  platform: Platform
): GitHubAsset | null {
  const candidates = release.assets.filter((asset) => !IGNORED_ASSETS.test(asset.name))
  for (const pattern of ASSET_PREFERENCE[platform]) {
    const match = candidates.find((asset) => pattern.test(asset.name))
    if (match) return match
  }
  return null
}

function toReleaseInfo(
  release: GitHubRelease,
  asset: GitHubAsset,
  downloadUrl: string
): LauncherReleaseInfo {
  return {
    version: versionFromTag(release.tag_name),
    tag: release.tag_name,
    name: release.name?.trim() || release.tag_name,
    publishedAt: release.published_at,
    prerelease: release.prerelease,
    url: release.html_url,
    notes: release.body ? release.body.slice(0, 20_000) : null,
    assetName: asset.name,
    assetSize: asset.size,
    assetDownloadUrl: downloadUrl,
    assetDigest: asset.digest ?? null
  }
}

export interface LauncherAssetResolution {
  repo: string
  repoInfo: GitHubRepo | null
  release: GitHubRelease | null
  asset: GitHubAsset | null
  error: string | null
}

/**
 * Resolves the newest stable release of the launcher itself, including the raw
 * asset the download endpoint needs. Kept separate from the product catalog so
 * the launcher never appears as an installable game.
 */
export async function resolveLauncherAsset(
  platform: Platform
): Promise<LauncherAssetResolution> {
  const repo = launcherRepo()
  const snapshot = await getRepoSnapshot(repo, false)

  if (!snapshot.release) {
    return {
      repo,
      repoInfo: snapshot.repo,
      release: null,
      asset: null,
      error:
        snapshot.repoError ??
        snapshot.releaseError ??
        'No launcher release has been published yet.'
    }
  }

  const asset = selectLauncherAsset(snapshot.release, platform)
  if (!asset) {
    return {
      repo,
      repoInfo: snapshot.repo,
      release: snapshot.release,
      asset: null,
      error: `The latest launcher release (${snapshot.release.tag_name}) has no ${PLATFORM_LABEL[platform]} build.`
    }
  }

  return {
    repo,
    repoInfo: snapshot.repo,
    release: snapshot.release,
    asset,
    error: null
  }
}

export async function resolveLauncherRelease(
  platform: Platform,
  baseUrl: string
): Promise<LauncherReleaseResponse> {
  const resolved = await resolveLauncherAsset(platform)

  if (!resolved.release || !resolved.asset) {
    return {
      platform,
      repo: resolved.repo,
      release: null,
      error: resolved.error
    }
  }

  const downloadUrl = new URL('/api/launcher/download', baseUrl)
  downloadUrl.searchParams.set('platform', platform)

  return {
    platform,
    repo: resolved.repo,
    release: toReleaseInfo(resolved.release, resolved.asset, downloadUrl.toString()),
    error: null
  }
}
