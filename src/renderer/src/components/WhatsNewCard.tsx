import { useState } from 'react'
import { WHATS_NEW } from '../whatsNew'
import { Icon } from './Icons'

const STORAGE_KEY = 'mcm98.whatsNewDismissed'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === WHATS_NEW.version
  } catch {
    return false
  }
}

export function WhatsNewCard(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(wasDismissed)

  if (dismissed) return null

  const dismiss = (): void => {
    setDismissed(true)
    try {
      window.localStorage.setItem(STORAGE_KEY, WHATS_NEW.version)
    } catch {
      // A locked-down profile can refuse storage; the card just returns next launch.
    }
  }

  return (
    <section className="whats-new" aria-labelledby="whats-new-title">
      <div className="whats-new-mark" aria-hidden="true">
        <Icon name="spark" size={17} />
      </div>

      <div className="whats-new-copy">
        <div className="whats-new-head">
          <span className="eyebrow">{WHATS_NEW.eyebrow}</span>
          <span className="whats-new-version mono">v{WHATS_NEW.version}</span>
        </div>
        <h2 id="whats-new-title">{WHATS_NEW.title}</h2>
        <ul className="whats-new-list">
          {WHATS_NEW.items.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="whats-new-dismiss"
        onClick={dismiss}
        title="Dismiss for this release"
        aria-label="Dismiss what's new"
      >
        <Icon name="close" size={14} />
      </button>
    </section>
  )
}
