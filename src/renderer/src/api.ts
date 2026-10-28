import type { LauncherApi } from '@shared/types'
import { createDemoApi } from './demo'

/**
 * The browser-only demo bridge is available in development builds. In a
 * packaged launcher a missing preload bridge is a real error, not demo mode.
 */
export const demoMode = !window.launcher && import.meta.env.DEV

let demoApi: LauncherApi | null = null

export function getLauncher(): LauncherApi {
  if (window.launcher) return window.launcher
  if (demoMode) {
    demoApi ??= createDemoApi()
    return demoApi
  }
  throw new Error(
    'The launcher bridge is unavailable. Restart MCM98 Launcher; if the problem persists, reinstall it.'
  )
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}
