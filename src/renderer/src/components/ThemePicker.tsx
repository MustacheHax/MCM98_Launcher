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

  const groups = useMemo(
    () =>
      THEME_FAMILIES.map((family) => ({
        family,
        themes: THEMES.filter(
          (item) => item.family === family.id && (mode === 'all' || item.mode === mode)
        )
      })).filter((group) => group.themes.length > 0),
    [mode]
  )

  return (
    <div className="theme-picker">
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

      {groups.map(({ family, themes }) => (
        <section className="theme-family" key={family.id}>
          <div className="theme-family-head">
            <h3>{family.label}</h3>
            <p>{family.blurb}</p>
          </div>

          <div className="theme-grid" role="radiogroup" aria-label={`${family.label} themes`}>
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
                      {item.mode === 'dark' ? 'Dark' : 'Light'}
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
        </section>
      ))}
    </div>
  )
}
