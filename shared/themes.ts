/**
 * Launcher appearance themes. Each family changes more than its palette:
 * typography, corner shape, borders, texture, and button treatment differ too.
 * The renderer loads the matching `[data-theme]` block from themes.css.
 */

export type ThemeMode = 'dark' | 'light'
export type ThemeFamily =
  | 'graf'
  | 'modern'
  | 'retro'
  | 'bubbly'
  | 'rocker'
  | 'ghost'
  | 'vapor'
  | 'terminal'
  | 'arcade'
  | 'night'
  | 'mono'

export type ThemeId =
  | 'graf-dark'
  | 'graf-light'
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
  | 'vapor-dark'
  | 'vapor-light'
  | 'terminal-dark'
  | 'terminal-light'
  | 'arcade-dark'
  | 'arcade-light'
  | 'night-dark'
  | 'night-light'
  | 'mono-dark'
  | 'mono-light'

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

export interface ThemeFamilyDefinition {
  id: ThemeFamily
  label: string
  blurb: string
}

/** Picker order: the original families first, then the newer additions. */
export const THEME_FAMILIES: ThemeFamilyDefinition[] = [
  { id: 'graf', label: 'Graffiti', blurb: 'Spray cyan, magenta, and orange on inked concrete.' },
  { id: 'modern', label: 'Modern', blurb: 'Graphite glass with a lime signal; the original shell.' },
  { id: 'retro', label: '90s Retro', blurb: 'CRT scanlines, beveled controls, beige workstations.' },
  { id: 'bubbly', label: 'Bubbly', blurb: 'Pill controls, candy gradient, round everything.' },
  { id: 'rocker', label: 'Rocker', blurb: 'Condensed italic type, clipped corners, stage red.' },
  { id: 'ghost', label: 'Ghost', blurb: 'Fog, translucent glass, and hairline serif type.' },
  { id: 'vapor', label: 'Vaporwave', blurb: 'Chrome horizons, neon magenta, wide tracking.' },
  { id: 'terminal', label: 'Terminal', blurb: 'Phosphor monospace, or a green-bar printout.' },
  { id: 'arcade', label: 'Arcade', blurb: 'Bold outlines, a pixel marquee face, cabinet colours.' },
  { id: 'night', label: 'Night Shift', blurb: 'Warm, dim, low-glare surfaces for late sessions.' },
  { id: 'mono', label: 'Mono', blurb: 'Greyscale, hairline borders, maximum contrast.' }
]

export const THEMES: ThemeDefinition[] = [
  {
    id: 'graf-dark',
    name: 'Graffiti Dark',
    family: 'graf',
    mode: 'dark',
    blurb: 'The wordmark turned into a theme: spray cyan, magenta, and orange on inked concrete.',
    swatches: ['#0a0b10', '#171b26', '#ff3f9a'],
    previewText: '#f6f7fb'
  },
  {
    id: 'graf-light',
    name: 'Graffiti Light',
    family: 'graf',
    mode: 'light',
    blurb: 'Paint on paper: magenta and teal over warm white, with poster-weight headings.',
    swatches: ['#f4f2ec', '#ffffff', '#c4147e'],
    previewText: '#14131a'
  },
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
  },
  {
    id: 'vapor-dark',
    name: 'Vaporwave Dark',
    family: 'vapor',
    mode: 'dark',
    blurb: 'A chrome horizon at midnight: neon magenta, cyan edges, wide-tracked caps.',
    swatches: ['#0a0517', '#1d1138', '#ff4fd0'],
    previewText: '#f7f0ff'
  },
  {
    id: 'vapor-light',
    name: 'Vaporwave Light',
    family: 'vapor',
    mode: 'light',
    blurb: 'Pearlescent daylight: lilac paper, magenta ink, and a soft cyan glow.',
    swatches: ['#f6f1ff', '#ffffff', '#b5179e'],
    previewText: '#1b0b33'
  },
  {
    id: 'terminal-dark',
    name: 'Terminal Dark',
    family: 'terminal',
    mode: 'dark',
    blurb: 'Green phosphor on black glass. Every pixel is monospace, every rule is 1px.',
    swatches: ['#04080a', '#0e171b', '#35ff8a'],
    previewText: '#d6ffe7'
  },
  {
    id: 'terminal-light',
    name: 'Terminal Light',
    family: 'terminal',
    mode: 'light',
    blurb: 'A green-bar printout: cream stock, dark ink, and a single beam-green signal.',
    swatches: ['#eef3ea', '#fbfdf8', '#0a7a3f'],
    previewText: '#0b1a10'
  },
  {
    id: 'arcade-dark',
    name: 'Arcade Dark',
    family: 'arcade',
    mode: 'dark',
    blurb: 'Cabinet violet with thick outlines, offset shadows, a pixel marquee face, and coin-op yellow.',
    swatches: ['#0b0819', '#221946', '#ffd23f'],
    previewText: '#fdf6ff'
  },
  {
    id: 'arcade-light',
    name: 'Arcade Light',
    family: 'arcade',
    mode: 'light',
    blurb: 'Coin-op on warm paper: indigo ink, chunky buttons, and hard drop shadows.',
    swatches: ['#fff7e3', '#ffffff', '#4b22d6'],
    previewText: '#17102e'
  },
  {
    id: 'night-dark',
    name: 'Night Shift Dark',
    family: 'night',
    mode: 'dark',
    blurb: 'Warm charcoal and candle-amber, tuned to take the blue out of a late session.',
    swatches: ['#100e0c', '#221d18', '#e0a86a'],
    previewText: '#f0e7db'
  },
  {
    id: 'night-light',
    name: 'Night Shift Light',
    family: 'night',
    mode: 'light',
    blurb: 'Lamplight on deep parchment: amber panels, brown ink, low glare.',
    swatches: ['#f4ead7', '#fffdf6', '#a2611f'],
    previewText: '#241a12'
  },
  {
    id: 'mono-dark',
    name: 'Mono Dark',
    family: 'mono',
    mode: 'dark',
    blurb: 'Pure black and white for maximum contrast, with no gradients or decoration.',
    swatches: ['#000000', '#121212', '#ffffff'],
    previewText: '#ffffff'
  },
  {
    id: 'mono-light',
    name: 'Mono Light',
    family: 'mono',
    mode: 'light',
    blurb: 'Paper white, black ink, and high-contrast rules. The accessibility option.',
    swatches: ['#ffffff', '#f2f2f2', '#000000'],
    previewText: '#000000'
  }
]

/** New installs start on the wordmark's own palette; saved themes are never rewritten. */
export const DEFAULT_THEME: ThemeId = 'graf-dark'

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value)
}

export function themeMode(id: ThemeId): ThemeMode {
  return THEMES.find((theme) => theme.id === id)?.mode ?? 'dark'
}

export function themeFamily(id: ThemeId): ThemeFamily | null {
  return THEMES.find((theme) => theme.id === id)?.family ?? null
}
