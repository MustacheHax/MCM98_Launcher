import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { CatalogResponse, HealthResponse, Platform } from '../../shared/types'
import { loadCatalog, PLATFORMS, type Catalog, type CatalogProduct } from './catalog'
import { hasGitHubToken, openAssetStream } from './github'
import { resolveProduct } from './resolver'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string }

const VERSION = packageJson.version
const catalogPath =
  process.env.CATALOG_PATH?.trim() ||
  fileURLToPath(new URL('../catalog.json', import.meta.url))

let catalog: Catalog
try {
  catalog = loadCatalog(catalogPath)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const productById = new Map<string, CatalogProduct>(
  catalog.products.map((product) => [product.id, product])
)

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')
app.use(compression())
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }))
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

app.use((req, res, next) => {
  if (req.path === '/api/health') return next()
  const startedAt = Date.now()
  res.on('finish', () => {
    console.info(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - startedAt}ms)`)
  })
  next()
})

function parsePlatform(req: Request, res: Response): Platform | null {
  const value = typeof req.query.platform === 'string' ? req.query.platform : ''
  if (!PLATFORMS.includes(value as Platform)) {
    res.status(400).json({
      error: 'A valid platform query parameter is required.',
      allowed: PLATFORMS
    })
    return null
  }
  return value as Platform
}

function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return `${req.protocol}://${req.get('host')}`
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next)
  }
}

app.get('/', (_req, res) => {
  res.json({
    service: 'MCM98 Launcher Relay',
    version: VERSION,
    endpoints: ['/api/health', '/api/catalog?platform=win32', '/api/download/:productId?platform=win32']
  })
})

app.get('/api/health', (_req, res) => {
  const health: HealthResponse = {
    ok: true,
    version: VERSION,
    timestamp: new Date().toISOString(),
    catalogProducts: catalog.products.length,
    githubAuthenticated: hasGitHubToken()
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json(health)
})

app.get(
  '/api/catalog',
  asyncRoute(async (req, res) => {
    const platform = parsePlatform(req, res)
    if (!platform) return

    const baseUrl = publicBaseUrl(req)
    const resolved = await Promise.all(
      catalog.products.map(async (product) => {
        try {
          return (await resolveProduct(product, platform, baseUrl)).entry
        } catch (error) {
          console.error(`[catalog] failed to resolve ${product.id}:`, error)
          return {
            id: product.id,
            name: product.name,
            summary: product.summary || 'This product could not be loaded.',
            repo: product.repo,
            repoUrl: `https://github.com/${product.repo}`,
            tags: product.tags,
            featured: product.featured,
            status: 'unavailable' as const,
            error: 'The relay could not resolve this product. Try refreshing.',
            platform,
            availablePlatforms: [],
            release: null,
            install: null
          }
        }
      })
    )

    const payload: CatalogResponse = {
      backendVersion: VERSION,
      generatedAt: new Date().toISOString(),
      platform,
      products: resolved
    }

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    res.json(payload)
  })
)

app.get(
  '/api/download/:productId',
  asyncRoute(async (req, res) => {
    const platform = parsePlatform(req, res)
    if (!platform) return

    const productId = typeof req.params.productId === 'string' ? req.params.productId : ''
    const product = productById.get(productId)
    if (!product) {
      res.status(404).json({ error: 'Unknown product.' })
      return
    }

    const baseUrl = publicBaseUrl(req)
    const resolved = await resolveProduct(product, platform, baseUrl)
    if (!resolved.asset) {
      res.status(404).json({
        error: resolved.entry.error ?? 'No downloadable asset for this platform.'
      })
      return
    }

    const asset = resolved.asset
    const isPrivate = resolved.repo?.private === true
    if (!isPrivate && process.env.FORCE_RELAY !== '1') {
      res.redirect(302, asset.browser_download_url)
      return
    }

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })

    try {
      const upstream = await openAssetStream(product.repo, asset.id, controller.signal)

      res.status(200)
      res.setHeader('Content-Type', asset.content_type || 'application/octet-stream')
      res.setHeader('Content-Length', String(asset.size))
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asset.name.replace(/["\r\n]/g, '_')}"`
      )
      res.setHeader('Cache-Control', 'no-store')

      if (!upstream.body) throw new Error('GitHub returned an empty asset stream.')
      await pipeline(
        Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream),
        res
      )
    } catch (error) {
      if (controller.signal.aborted) return
      console.error(`[download] ${product.id} (${asset.name}) failed:`, error)
      if (!res.headersSent) {
        res.status(502).json({ error: 'The relay could not stream this release asset.' })
      } else {
        res.destroy()
      }
    }
  })
)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' })
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', error)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal relay error.' })
  }
})

const port = Number(process.env.PORT ?? 8790)
const server = app.listen(port, '0.0.0.0', () => {
  console.info(
    `MCM98 relay v${VERSION} listening on :${port} — ${catalog.products.length} product(s), GitHub token ${hasGitHubToken() ? 'configured' : 'NOT configured'}`
  )
  if (catalog.products.length === 0) {
    console.warn(`Catalog ${catalog.sourcePath} is empty. Add products before shipping the launcher.`)
  }
})

function shutdown(signal: string): void {
  console.info(`[server] ${signal} received, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 8_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
