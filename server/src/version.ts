import { readFileSync } from 'node:fs'

/** Relay version, kept in one place so the health endpoint and GitHub client agree. */
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
