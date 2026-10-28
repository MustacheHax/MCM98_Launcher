export interface GitHubAsset {
  id: number
  name: string
  size: number
  content_type: string
  digest: string | null
  browser_download_url: string
}

export interface GitHubRelease {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
  published_at: string
  html_url: string
  assets: GitHubAsset[]
}

export interface GitHubRepo {
  name: string
  full_name: string
  html_url: string
  description: string | null
  private: boolean
  archived: boolean
  topics?: string[]
}

export interface RepoSnapshot {
  repo: GitHubRepo | null
  release: GitHubRelease | null
  repoError: string | null
  releaseError: string | null
  fetchedAt: number
  stale: boolean
}

const API_BASE = 'https://api.github.com'
const USER_AGENT = 'mcm98-launcher-relay/0.1'
const configuredTtl = Number(process.env.CACHE_TTL_SECONDS ?? 300)
const SUCCESS_TTL_MS = (Number.isFinite(configuredTtl) ? Math.max(30, configuredTtl) : 300) * 1000
const ERROR_TTL_MS = 60_000

class GitHubError extends Error {
  readonly status: number
  readonly rateLimited: boolean

  constructor(message: string, status: number, rateLimited = false) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.rateLimited = rateLimited
  }
}

const snapshotCache = new Map<string, RepoSnapshot & { expiresAt: number }>()

function token(): string | undefined {
  const value = process.env.GITHUB_TOKEN?.trim()
  return value || undefined
}

export function hasGitHubToken(): boolean {
  return Boolean(token())
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  }
  const value = token()
  if (value) headers.Authorization = `Bearer ${value}`
  return headers
}

async function request<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GitHubError(`Could not reach GitHub: ${message}`, 0)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const payload = (await response.json()) as { message?: string }
      detail = payload.message ? ` (${payload.message})` : ''
    } catch {
      // Ignore non-JSON error bodies.
    }

    const remaining = response.headers.get('x-ratelimit-remaining')
    const rateLimited =
      (response.status === 403 || response.status === 429) && remaining === '0'

    if (response.status === 404) {
      throw new GitHubError('Not found', 404)
    }
    if (rateLimited) {
      throw new GitHubError(
        'GitHub API rate limit reached. Add a GITHUB_TOKEN to the relay or try again later.',
        403,
        true
      )
    }
    if (response.status === 401) {
      throw new GitHubError('GitHub rejected the configured GITHUB_TOKEN.', 401)
    }
    throw new GitHubError(
      `GitHub returned HTTP ${response.status}${detail}`,
      response.status
    )
  }

  return (await response.json()) as T
}

function describe(error: unknown, context: 'repo' | 'release'): string {
  if (!(error instanceof GitHubError)) {
    return error instanceof Error ? error.message : String(error)
  }
  if (error.status === 404) {
    return context === 'repo'
      ? 'Repository not found, or it is private and the relay has no GitHub token with access.'
      : 'This repository has no published releases yet.'
  }
  return error.message
}

/**
 * Opens a release asset through the GitHub API. Works for public and private
 * repositories; the token is never exposed to the client.
 */
export async function openAssetStream(
  repo: string,
  assetId: number,
  signal: AbortSignal
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/repos/${repo}/releases/assets/${assetId}`, {
      headers: {
        ...authHeaders(),
        Accept: 'application/octet-stream'
      },
      redirect: 'follow',
      signal
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GitHubError(`Could not reach GitHub: ${message}`, 0)
  }

  if (!response.ok) {
    const rateLimited = response.headers.get('x-ratelimit-remaining') === '0'
    throw new GitHubError(
      rateLimited
        ? 'GitHub API rate limit reached while fetching the release asset.'
        : `GitHub returned HTTP ${response.status} for the release asset.`,
      response.status,
      rateLimited
    )
  }
  return response
}

async function fetchRepo(repo: string): Promise<GitHubRepo> {
  return request<GitHubRepo>(`/repos/${repo}`)
}

async function fetchRelease(repo: string, includePrereleases: boolean): Promise<GitHubRelease> {
  if (includePrereleases) {
    const releases = await request<GitHubRelease[]>(`/repos/${repo}/releases?per_page=10`)
    const release = releases.find((item) => !item.draft)
    if (!release) {
      throw new GitHubError('Not found', 404)
    }
    return release
  }
  return request<GitHubRelease>(`/repos/${repo}/releases/latest`)
}

/**
 * Returns repository metadata and the newest release. Successful responses are
 * cached; failed refreshes fall back to the last good snapshot.
 */
export async function getRepoSnapshot(
  repo: string,
  includePrereleases: boolean
): Promise<RepoSnapshot> {
  const key = `${repo.toLowerCase()}|${includePrereleases ? 'pre' : 'stable'}`
  const cached = snapshotCache.get(key)
  const now = Date.now()

  if (cached && cached.expiresAt > now) {
    return cached
  }

  const [repoResult, releaseResult] = await Promise.allSettled([
    fetchRepo(repo),
    fetchRelease(repo, includePrereleases)
  ])

  const repoValue = repoResult.status === 'fulfilled' ? repoResult.value : null
  const releaseValue = releaseResult.status === 'fulfilled' ? releaseResult.value : null
  const repoError =
    repoResult.status === 'rejected' ? describe(repoResult.reason, 'repo') : null
  const releaseError =
    releaseResult.status === 'rejected' ? describe(releaseResult.reason, 'release') : null

  if (!repoValue && !releaseValue && cached && now - cached.fetchedAt < 60 * 60 * 1000) {
    console.warn(`[github] serving stale snapshot for ${repo}: ${repoError ?? releaseError}`)
    return { ...cached, stale: true }
  }

  const snapshot: RepoSnapshot = {
    repo: repoValue,
    release: releaseValue,
    repoError,
    releaseError,
    fetchedAt: now,
    stale: false
  }

  const hasFailure = Boolean(repoError || releaseError)
  const ttl = hasFailure ? ERROR_TTL_MS : SUCCESS_TTL_MS

  snapshotCache.set(key, { ...snapshot, expiresAt: now + ttl })

  if (repoError) console.warn(`[github] ${repo}: ${repoError}`)
  if (releaseError) console.warn(`[github] ${repo}: ${releaseError}`)

  return snapshot
}
