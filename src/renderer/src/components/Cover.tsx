import type { CSSProperties } from 'react'
import { initials } from '../utils'

const PALETTES: Array<[string, string]> = [
  ['#d8ff54', '#1f5a3c'],
  ['#ffb35c', '#7a2e14'],
  ['#a996ff', '#2e2470'],
  ['#5fe8d0', '#0f4b46'],
  ['#ff8fab', '#6d1b36'],
  ['#7cc7ff', '#1c3c77'],
  ['#f3d36a', '#5d4513'],
  ['#b6f09c', '#2c5224']
]

function hashValue(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

interface CoverProps {
  seed: string
  title: string
  className?: string
  silhouette?: boolean
}

export function Cover({ seed, title, className, silhouette = true }: CoverProps): JSX.Element {
  const palette = PALETTES[hashValue(seed) % PALETTES.length] as [string, string]
  const style = {
    '--cover-a': palette[0],
    '--cover-b': palette[1]
  } as CSSProperties

  return (
    <div className={`cover ${className ?? ''}`} style={style} aria-hidden="true">
      <span className="cover-wash" />
      <span className="cover-grid" />
      <span className="cover-orb" />
      {silhouette && <span className="cover-ghost">{initials(title)}</span>}
      <span className="cover-edge" />
    </div>
  )
}
