import { net } from 'electron'
import type {
  CatalogResponse,
  HealthResponse,
  LauncherConfig,
  Platform
} from '@shared/types'
import type { Logger } from './logger'

export class RelayError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'RelayError'
    this.retryable = retryable
  }
}

interface FetchOptions {
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

async function requestJson<T>(
  url: string,
  log: Logger,
  options: FetchOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2)
  const timeoutMs = options.timeoutMs ?? 30_000
  const retryDelayMs = options.retryDelayMs ?? 2_000
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await net.fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'MCM98-Launcher/0.1' }
      })

      if (!response.ok) {
        const detail = await readErrorDetail(response)
        const retryable = [502, 503, 504].includes(response.status)
        throw new RelayError(
          response.status === 503
            ? 'The relay is waking up. Try again in a moment.'
            : `The relay returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
          retryable
        )
      }

      return (await response.json()) as T
    } catch (error) {
      const normalized = normalizeError(error, url)
      lastError = normalized
      log.warn(`Relay request failed (attempt ${attempt}/${attempts}): ${normalized.message}`)

      if (attempt < attempts && normalized instanceof RelayError && !normalized.retryable) {
        // Authentication or bad-URL failures will not improve on retry.
        if (/HTTP 4\d\d/.test(normalized.message)) break
      }
      if (attempt < attempts) {
        await delay(retryDelayMs * attempt)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new RelayError('The relay request failed.')
}

function normalizeError(error: unknown, url: string): RelayError {
  if (error instanceof RelayError) return error
  const host = safeHost(url)
  if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) {
    return new RelayError(
      `The relay at ${host} did not respond in time. On Render's free tier it may be waking up; try again.`,
      true
    )
  }
  if (error instanceof Error && /fetch failed|net::|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
    return new RelayError(
      `Could not reach the relay at ${host}. Check the relay URL in Settings and that the Render service is running.`,
      true
    )
  }
  return new RelayError(
    error instanceof Error ? error.message : 'The relay request failed.',
    true
  )
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 300)
    if (!text) return ''
    try {
      const payload = JSON.parse(text) as { error?: string; message?: string }
      return payload.error ?? payload.message ?? ''
    } catch {
      return text.replace(/\s+/g, ' ').trim()
    }
  } catch {
    return ''
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertCatalog(payload: unknown): asserts payload is CatalogResponse {
  if (!payload || typeof payload !== 'object') throw new RelayError('The relay returned an invalid response.')
  const catalog = payload as Partial<CatalogResponse>
  if (!Array.isArray(catalog.products) || typeof catalog.platform !== 'string') {
    throw new RelayError('The relay returned a catalog the launcher cannot read.')
  }
}

function assertHealth(payload: unknown): asserts payload is HealthResponse {
  if (!payload || typeof payload !== 'object' || (payload as HealthResponse).ok !== true) {
    throw new RelayError('The relay health check returned an unexpected response.')
  }
}

export async function fetchCatalog(
  config: LauncherConfig,
  platform: Platform,
  log: Logger
): Promise<CatalogResponse> {
  const url = joinUrl(config.backendUrl, `/api/catalog?platform=${encodeURIComponent(platform)}`)
  const payload = await requestJson<unknown>(url, log)
  assertCatalog(payload)
  return payload
}

export async function checkBackend(
  backendUrl: string,
  log: Logger
): Promise<HealthResponse> {
  const normalized = backendUrl.replace(/\/+$/, '')
  const payload = await requestJson<unknown>(joinUrl(normalized, '/api/health'), log, {
    attempts: 1,
    timeoutMs: 20_000
  })
  assertHealth(payload)
  return payload
}
