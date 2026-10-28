/**
 * Launcher appearance themes. Each family changes more than its palette:
 * typography, corner shape, borders, texture, and button treatment differ too.
 * The renderer loads the matching `[data-theme]` block from styles.css.
 */

export type ThemeMode = 'dark' | 'light'
export type ThemeFamily = 'modern' | 'retro' | 'bubbly' | 'rocker' | 'ghost'

export type ThemeId =
  | 'modern-dark'
  | 'modern-light'
  | 'retro-dark'
  | 'retro-light'
  | 'bubbly-dark'
  | 'bubbly-light'
  | 'rocker-dark'
  | 'rocker-light'
  | 'ghost-dark'
  | 'ghost-light'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  family: ThemeFamily
  mode: ThemeMode
  blurb: string
  /** Preview swatches: background, surface, accent. */
  swatches: [string, string, string]
  /** Preview text colour used inside the mini theme card. */
  previewText: string
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'modern-dark',
    name: 'Modern Dark',
    family: 'modern',
    mode: 'dark',
    blurb: 'The original MCM98 look: graphite glass, lime signal, tight geometry.',
    swatches: ['#07080b', '#141922', '#d8ff54'],
    previewText: '#f1f3f7'
  },
  {
    id: 'modern-light',
    name: 'Modern Light',
    family: 'modern',
    mode: 'light',
    blurb: 'Clean daylight studio with the same lime signal and crisp cards.',
    swatches: ['#eef0ea', '#ffffff', '#527a00'],
    previewText: '#10130c'
  },
  {
    id: 'retro-dark',
    name: '90s Retro Dark',
    family: 'retro',
    mode: 'dark',
    blurb: 'CRT scanlines, hard corners, and a terminal teal from another decade.',
    swatches: ['#080b0d', '#12181b', '#3ef0c8'],
    previewText: '#e8f5ef'
  },
  {
    id: 'retro-light',
    name: '90s Retro Light',
    family: 'retro',
    mode: 'light',
    blurb: 'Beige workstations, outset buttons, and classic midnight-blue accents.',
    swatches: ['#dedbd0', '#efede6', '#000080'],
    previewText: '#111111'
  },
  {
    id: 'bubbly-dark',
    name: 'Bubbly Dark',
    family: 'bubbly',
    mode: 'dark',
    blurb: 'Deep plum, candy pink, floating orbs, and impossibly round everything.',
    swatches: ['#120a20', '#221238', '#ff8ad8'],
    previewText: '#fff4ff'
  },
  {
    id: 'bubbly-light',
    name: 'Bubbly Light',
    family: 'bubbly',
    mode: 'light',
    blurb: 'Pastel sherbet, pill buttons, and soft, bouncy cards.',
    swatches: ['#fdf2fb', '#ffffff', '#d63a91'],
    previewText: '#3a1747'
  },
  {
    id: 'rocker-dark',
    name: 'Rocker Dark',
    family: 'rocker',
    mode: 'dark',
    blurb: 'Brushed black, stage-red accents, and condensed italic type.',
    swatches: ['#070707', '#171717', '#ff3b30'],
    previewText: '#f5f0e7'
  },
  {
    id: 'rocker-light',
    name: 'Rocker Light',
    family: 'rocker',
    mode: 'light',
    blurb: 'Bone-white print, hard black rules, and a blood-red accent.',
    swatches: ['#f1ede4', '#fffdf8', '#b8121e'],
    previewText: '#171412'
  },
  {
    id: 'ghost-dark',
    name: 'Ghost Dark',
    family: 'ghost',
    mode: 'dark',
    blurb: 'Fog, translucent glass, and thin serif type that barely touches the page.',
    swatches: ['#090d13', '#121a24', '#c9b8ff'],
    previewText: '#e9edf4'
  },
  {
    id: 'ghost-light',
    name: 'Ghost Light',
    family: 'ghost',
    mode: 'light',
    blurb: 'Morning mist, porcelain panels, and a quiet lavender presence.',
    swatches: ['#f0f1f5', '#ffffff', '#6d5bd0'],
    previewText: '#1c212c'
  }
]

export const DEFAULT_THEME: ThemeId = 'modern-dark'

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value)
}

export function themeMode(id: ThemeId): ThemeMode {
  return THEMES.find((theme) => theme.id === id)?.mode ?? 'dark'
}
