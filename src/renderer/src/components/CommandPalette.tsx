import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useApp } from '../state'
import { versionLabel } from '../utils'
import { Icon, type IconName } from './Icons'

interface Command {
  id: string
  label: string
  hint: string
  icon: IconName
  run: () => void
}

const MAX_COMMANDS = 40

/**
 * Keyboard-first jump list. Every view, every installed product, and the
 * common maintenance actions are two keystrokes away.
 */
export function CommandPalette(): JSX.Element {
  const {
    navigate,
    closePalette,
    library,
    catalog,
    openProduct,
    launch,
    running,
    refreshCatalog,
    checkLauncherUpdate,
    openFolder,
    openDataFolder
  } = useApp()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useMemo<Command[]>(() => {
    const entries: Command[] = [
      {
        id: 'view-library',
        label: 'Go to Library',
        hint: 'View',
        icon: 'library',
        run: () => navigate('library')
      },
      {
        id: 'view-catalog',
        label: 'Go to Catalog',
        hint: 'View',
        icon: 'catalog',
        run: () => navigate('catalog')
      },
      {
        id: 'view-downloads',
        label: 'Go to Downloads',
        hint: 'View',
        icon: 'download',
        run: () => navigate('downloads')
      },
      {
        id: 'view-settings',
        label: 'Go to Settings',
        hint: 'View',
        icon: 'settings',
        run: () => navigate('settings')
      },
      {
        id: 'refresh-catalog',
        label: 'Check product updates',
        hint: 'Action',
        icon: 'refresh',
        run: () => void refreshCatalog()
      },
      {
        id: 'check-launcher',
        label: 'Check for launcher updates',
        hint: 'Action',
        icon: 'spark',
        run: () => void checkLauncherUpdate()
      },
      {
        id: 'open-install-root',
        label: 'Open install folder',
        hint: 'Action',
        icon: 'folder',
        run: () => void openFolder()
      },
      {
        id: 'open-data',
        label: 'Open launcher data folder',
        hint: 'Action',
        icon: 'folder',
        run: () => void openDataFolder()
      }
    ]

    for (const installed of library) {
      if (running.includes(installed.id)) continue
      entries.push({
        id: `play-${installed.id}`,
        label: `Play ${installed.name}`,
        hint: versionLabel(installed.version),
        icon: 'play',
        run: () => void launch(installed.id)
      })
    }

    for (const product of catalog?.products ?? []) {
      entries.push({
        id: `open-${product.id}`,
        label: `${product.name} details`,
        hint: product.repo,
        icon: 'chevronRight',
        run: () => openProduct(product)
      })
    }

    return entries.slice(0, MAX_COMMANDS)
  }, [
    navigate,
    library,
    catalog,
    running,
    launch,
    openProduct,
    refreshCatalog,
    checkLauncherUpdate,
    openFolder,
    openDataFolder
  ])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint}`.toLowerCase().includes(needle)
    )
  }, [commands, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [query])

  const execute = (command: Command | undefined): void => {
    if (!command) return
    closePalette()
    command.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) =>
        filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      execute(filtered[active])
    }
  }

  return (
    <div
      className="palette-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <label className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search views, products, and actions"
            aria-label="Command palette search"
          />
          <kbd className="palette-kbd">esc</kbd>
        </label>

        <ul className="palette-list" role="listbox" aria-label="Commands">
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={`palette-item ${index === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => execute(command)}
              >
                <Icon name={command.icon} size={15} />
                <span className="palette-label">{command.label}</span>
                <span className="palette-hint">{command.hint}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="palette-empty">
              Nothing matched “{query.trim()}”. Try a product or view name.
            </li>
          )}
        </ul>

        <div className="palette-foot">
          <span className="palette-key">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            move
          </span>
          <span className="palette-key">
            <kbd>⏎</kbd>
            run
          </span>
          <span className="palette-key">
            <kbd>ctrl</kbd>
            <kbd>k</kbd>
            toggle
          </span>
        </div>
      </div>
    </div>
  )
}
