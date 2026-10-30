import { Icon, type IconName } from './Icons'
import { useApp, type View } from '../state'
import { isTerminalPhase, launcherReleaseLabel } from '../utils'

const NAV_ITEMS: Array<{ view: View; label: string; icon: IconName }> = [
  { view: 'library', label: 'Library', icon: 'library' },
  { view: 'catalog', label: 'Catalog', icon: 'catalog' },
  { view: 'downloads', label: 'Downloads', icon: 'download' },
  { view: 'settings', label: 'Settings', icon: 'settings' }
]

export function TitleBar(): JSX.Element {
  const { appInfo, demoMode } = useApp()
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img className="brand-logo" src="./logo.png" alt="MCM98" />
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-sub">Launcher</span>
      </div>
      <div className="titlebar-right">
        {demoMode && <span className="demo-pill">Demo data</span>}
        <span className="titlebar-version">v{appInfo?.version ?? '0.3.0'}</span>
      </div>
    </header>
  )
}

export function Sidebar(): JSX.Element {
  const { view, navigate, library, tasks, launcherUpdate } = useApp()

  const activeDownloads = tasks.filter((task) => !isTerminalPhase(task.phase)).length

  return (
    <aside className="sidebar">
      <div className="nav-label">Workspace</div>
      <nav className="nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const count =
            item.view === 'library'
              ? library.length
              : item.view === 'downloads'
                ? activeDownloads
                : null
          const isActive = view === item.view
          return (
            <button
              key={item.view}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => navigate(item.view)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={count !== null && count > 0 ? `${item.label} (${count})` : item.label}
              title={item.label}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {count !== null && count > 0 && <span className="nav-count">{count}</span>}
              {item.view === 'downloads' && activeDownloads > 0 && <span className="nav-live" />}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-spacer" />

      {launcherUpdate?.state === 'available' && (
        <button
          className="sidebar-update"
          onClick={() => navigate('settings')}
          title={`Launcher update ${launcherReleaseLabel(
            launcherUpdate.latestVersion,
            launcherUpdate.releaseName
          )} is available`}
        >
          <span className="sidebar-update-dot" />
          <span>
            Launcher {launcherReleaseLabel(launcherUpdate.latestVersion, launcherUpdate.releaseName)}
          </span>
          <Icon name="chevronRight" size={13} />
        </button>
      )}

    </aside>
  )
}
