import { useState } from 'react'
import { THEMES, type ThemeId } from '@shared/themes'
import { useApp } from '../state'
import { Icon } from './Icons'

const FAMILY_LABEL: Record<string, string> = {
  modern: 'Modern',
  retro: '90s Retro',
  bubbly: 'Bubbly',
  rocker: 'Rocker',
  ghost: 'Ghost',
  graf: 'Graffiti'
}

export function ThemePicker(): JSX.Element {
  const { theme, setTheme } = useApp()
  const [pending, setPending] = useState<ThemeId | null>(null)

  const choose = async (id: ThemeId): Promise<void> => {
    if (pending || id === theme) return
    setPending(id)
    try {
      await setTheme(id)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="theme-grid" role="radiogroup" aria-label="Launcher theme">
      {THEMES.map((item) => {
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
                  <span className="theme-preview-title">
                    {item.family === 'retro'
                      ? 'SYSTEM READY'
                      : item.family === 'bubbly'
                        ? 'Hey there!'
                        : item.family === 'rocker'
                          ? 'TURN IT UP'
                          : item.family === 'ghost'
                            ? 'Still here'
                            : item.family === 'graf'
                              ? 'Paint it loud'
                              : 'Library'}
                  </span>
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line is-short" />
                  <span className="theme-preview-button">Play</span>
                </span>
              </span>
            </span>

            <span className="theme-card-copy">
              <span className="theme-card-name">{item.name}</span>
              <span className="theme-card-meta">
                {item.mode === 'dark' ? 'Dark' : 'Light'} · {FAMILY_LABEL[item.family]}
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
  )
}
