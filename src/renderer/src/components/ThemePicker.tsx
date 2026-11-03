import { useMemo, useState } from 'react'
import {
  THEMES,
  THEME_FAMILIES,
  type ThemeFamily,
  type ThemeId,
  type ThemeMode
} from '@shared/themes'
import { useApp } from '../state'
import { Icon } from './Icons'

type ModeFilter = 'all' | ThemeMode

/** Preview headline per family, so each card reads in its own voice. */
const PREVIEW_TITLE: Record<ThemeFamily, string> = {
  retro: 'SYSTEM READY',
  bubbly: 'Hey there!',
  rocker: 'TURN IT UP',
  ghost: 'Still here',
  graf: 'Paint it loud',
  vapor: 'NEON NIGHTS',
  terminal: 'SYSTEM OK',
  arcade: 'INSERT COIN',
  night: 'Quiet hours',
  mono: 'Library',
  modern: 'Library'
}

const FAMILY_LABEL = Object.fromEntries(
  THEME_FAMILIES.map((family) => [family.id, family.label])
) as Record<ThemeFamily, string>

const MODES: Array<{ id: ModeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

export function ThemePicker(): JSX.Element {
  const { theme, setTheme } = useApp()
  const [pending, setPending] = useState<ThemeId | null>(null)
  const [mode, setMode] = useState<ModeFilter>('all')

  const choose = async (id: ThemeId): Promise<void> => {
    if (pending || id === theme) return
    setPending(id)
    try {
      await setTheme(id)
    } finally {
      setPending(null)
    }
  }

  // One grid for every family: the themes stay in family order, and each card
  // names its own family, so browsing is a scan across rows instead of eleven
  // two-item sections stacked on top of each other.
  const themes = useMemo(
    () => THEMES.filter((item) => mode === 'all' || item.mode === mode),
    [mode]
  )

  return (
    <div className="theme-picker">
      <div className="theme-picker-head">
        <div className="theme-mode-filter" role="tablist" aria-label="Theme brightness">
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={mode === option.id}
              className={`theme-mode-option ${mode === option.id ? 'is-active' : ''}`}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="theme-picker-count">
          {themes.length} of {THEMES.length} themes
        </p>
      </div>

      <div className="theme-grid" role="radiogroup" aria-label="Launcher theme">
        {themes.map((item) => {
          const active = item.id === theme
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${item.name} theme`}
              className={`theme-card ${active ? 'is-active' : ''}`}
              onClick={() => void choose(item.id)}
              disabled={pending !== null}
              title={item.blurb}
            >
              <span className="theme-preview" data-theme={item.id} aria-hidden="true">
                <span className="theme-preview-bar">
                  <span className="theme-preview-dot" />
                  <span className="theme-preview-dot" />
                  <span className="theme-preview-dot" />
                </span>
                <span className="theme-preview-body">
                  <span className="theme-preview-nav">
                    <span className="theme-preview-nav-line is-active" />
                    <span className="theme-preview-nav-line" />
                    <span className="theme-preview-nav-line" />
                  </span>
                  <span className="theme-preview-panel">
                    <span className="theme-preview-kicker">MCM98</span>
                    <span className="theme-preview-title">{PREVIEW_TITLE[item.family]}</span>
                    <span className="theme-preview-line" />
                    <span className="theme-preview-line is-short" />
                    <span className="theme-preview-button">Play</span>
                  </span>
                </span>
              </span>

              <span className="theme-card-copy">
                <span className="theme-card-name">{item.name}</span>
                <span className="theme-card-meta">
                  {FAMILY_LABEL[item.family]} · {item.mode === 'dark' ? 'Dark' : 'Light'}
                </span>
              </span>

              <span className="theme-swatches" aria-hidden="true">
                {item.swatches.map((color) => (
                  <span key={color} className="theme-swatch" style={{ background: color }} />
                ))}
              </span>

              {active && (
                <span className="theme-check" aria-hidden="true">
                  <Icon name="check" size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
