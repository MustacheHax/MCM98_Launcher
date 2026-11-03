import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SaveRoot } from './saves'

/**
 * Places games keep player data on each platform. `saves.ts` scans these; it
 * stays Electron-free so its matching rules can be tested in plain Node, and
 * this is the only file that has to ask Electron where the folders are.
 */
export function defaultSaveRoots(): SaveRoot[] {
  const roots: SaveRoot[] = []

  const push = (value: string | undefined): void => {
    if (!value) return
    if (roots.some((item) => item.path === value)) return
    roots.push({ path: value, source: 'appData' })
  }

  try {
    const documents = app.getPath('documents')
    if (documents) roots.push({ path: documents, source: 'documents' })
  } catch {
    // The documents folder can be unavailable on trimmed-down systems.
  }

  if (process.platform === 'win32') {
    push(process.env.APPDATA)
    push(process.env.LOCALAPPDATA)
    // Unity titles write under LocalLow, which sits outside the roaming folder.
    push(join(homedir(), 'AppData', 'LocalLow'))
    try {
      push(app.getPath('appData'))
    } catch {
      // Ignore a missing roaming folder.
    }
  } else if (process.platform === 'darwin') {
    push(join(homedir(), 'Library', 'Application Support'))
  } else {
    push(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'))
    push(join(homedir(), '.config'))
  }

  return roots
}
