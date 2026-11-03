import { VERSION } from './version'

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
const USER_AGENT = `mcm98-launcher-relay/${VERSION}`
const configuredTtl = Number(process.env.CACHE_TTL_SECONDS ?? 300)
const SUCCESS_TTL_MS = (Number.isFinite(configuredTtl) ? Math.max(30, configuredTtl) : 300) * 1000
const ERROR_TTL_MS = 60_000

class GitHubError extends Error {
  readonly status: number
  readonly rateLimited: boolean
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    status: number,
    rateLimited = false,
    retryAfterSeconds: number | null = null
  ) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.rateLimited = rateLimited
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Reads how long GitHub wants the caller to wait: `Retry-After` when present,
 * otherwise the reset time GitHub reports for the API window.
 */
function retryAfterSeconds(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  }

  const reset = headers.get('x-ratelimit-reset')
  if (reset) {
    const epoch = Number(reset)
    if (Number.isFinite(epoch)) return Math.max(0, Math.ceil(epoch - Date.now() / 1000))
  }
  return null
}

/** The wait GitHub asked for, when an error was caused by rate limiting. */
export function rateLimitRetrySeconds(error: unknown): number | null {
  return error instanceof GitHubError && error.rateLimited
    ? error.retryAfterSeconds
    : null
}

const snapshotCache = new Map<string, RepoSnapshot & { expiresAt: number }>()

const TOKEN_PREFIXES = [
  'github_pat_',
  'ghp_',
  'ghs_',
  'ghu_',
  'gho_',
  'ghr_'
] as const

const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/

interface TokenState {
  value: string | null
  problem: string | null
}

function stripTokenWrapper(raw: string): string {
  let value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`')
    ) {
      value = value.slice(1, -1).trim()
    }
  }
  // Dashboard UIs sometimes leave the auth scheme in the value.
  return value.replace(/^(?:bearer|token)\s+/i, '').trim()
}

/**
 * Reads GITHUB_TOKEN and rejects credentials GitHub cannot use in a Bearer
 * header. Never include the credential itself in a returned message: these
 * errors are shown to launcher clients and written to relay logs.
 */
function readToken(): TokenState {
  const raw = process.env.GITHUB_TOKEN
  if (!raw || !raw.trim()) {
    return { value: null, problem: null }
  }

  const unwrapped = stripTokenWrapper(raw)
  const compact = unwrapped.replace(/\s+/g, '')

  if (PRIVATE_KEY_MARKER.test(unwrapped) || /^MII[A-Za-z0-9+/=]{40,}/.test(compact)) {
    return {
      value: null,
      problem:
        'GITHUB_TOKEN contains a GitHub App private key, not an access token. A private key cannot be used as an API token. Create a fine-grained personal access token with read-only Contents access instead.'
    }
  }

  if (JWT_PATTERN.test(compact)) {
    return {
      value: null,
      problem:
        'GITHUB_TOKEN contains a GitHub App JWT, which cannot authorize repository requests. Create a fine-grained personal access token with read-only Contents access instead.'
    }
  }

  if (compact.length < 20) {
    return {
      value: null,
      problem: 'GITHUB_TOKEN is too short to be a GitHub access token.'
    }
  }

  if (!/^[\x21-\x7E]+$/.test(compact)) {
    return {
      value: null,
      problem:
        'GITHUB_TOKEN contains non-ASCII characters that cannot be sent in an HTTP header. Copy the token directly from GitHub; do not retype it or use smart quotes.'
    }
  }

  if (!TOKEN_PREFIXES.some((prefix) => compact.startsWith(prefix))) {
    return {
      value: null,
      problem:
        'GITHUB_TOKEN does not look like a GitHub access token. Use a fine-grained personal access token (starts with github_pat_) or a classic token (starts with ghp_) with access to the repository.'
    }
  }

  return { value: compact, problem: null }
}

export function hasGitHubToken(): boolean {
  return readToken().value !== null
}

/** Safe for logs and health responses; never contains the credential. */
export function getGitHubTokenProblem(): string | null {
  return readToken().problem
}

function redact(message: string, token: string | null): string {
  if (!token) return message
  return message.split(token).join('[redacted]')
}

function authHeaders(): Record<string, string> {
  const state = readToken()
  if (state.problem) {
    throw new GitHubError(`The relay's GITHUB_TOKEN is not usable. ${state.problem}`, 500)
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  }
  if (state.value) headers.Authorization = `Bearer ${state.value}`
  return headers
}

async function request<T>(path: string): Promise<T> {
  const state = readToken()
  const headers = authHeaders()
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GitHubError(`Could not reach GitHub: ${redact(message, state.value)}`, 0)
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
    const wait = retryAfterSeconds(response.headers)
    const rateLimited =
      (response.status === 403 || response.status === 429) &&
      (remaining === '0' || wait !== null)

    if (response.status === 404) {
      throw new GitHubError('Not found', 404)
    }
    if (rateLimited) {
      throw new GitHubError(
        `GitHub API rate limit reached. Add a GITHUB_TOKEN to the relay or try again${
          wait === null ? ' later' : ` in ${wait}s`
        }.`,
        403,
        true,
        wait
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
 * repositories; the token is never exposed to the client. A `range` header is
 * forwarded so the launcher can resume an interrupted download.
 */
export async function openAssetStream(
  repo: string,
  assetId: number,
  signal: AbortSignal,
  range?: string | null
): Promise<Response> {
  const state = readToken()
  const headers: Record<string, string> = {
    ...authHeaders(),
    Accept: 'application/octet-stream'
  }
  if (range) headers.Range = range
  let response: Response
  try {
    response = await fetch(`${API_BASE}/repos/${repo}/releases/assets/${assetId}`, {
      headers,
      redirect: 'follow',
      signal
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GitHubError(`Could not reach GitHub: ${redact(message, state.value)}`, 0)
  }

  if (!response.ok) {
    const wait = retryAfterSeconds(response.headers)
    const rateLimited =
      response.headers.get('x-ratelimit-remaining') === '0' || wait !== null
    throw new GitHubError(
      rateLimited
        ? `GitHub API rate limit reached while fetching the release asset${
            wait === null ? '' : `; retry in ${wait}s`
          }.`
        : `GitHub returned HTTP ${response.status} for the release asset.`,
      response.status,
      rateLimited,
      wait
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
