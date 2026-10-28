import { Icon, type IconName } from './Icons'
import { useApp, type View } from '../state'
import { isTerminalPhase, launcherReleaseLabel } from '../utils'

const NAV_ITEMS: Array<{ view: View; label: string; icon: IconName }> = [
  { view: 'library', label: 'Library', icon: 'library' },
  { view: 'catalog', label: 'Catalog', icon: 'catalog' },
  { view: 'downloads', label: 'Downloads', icon: 'download' },
  { view: 'settings', label: 'Settings', icon: 'settings' }
]

function hostFromUrl(value: string | undefined): string {
  if (!value) return 'Not configured'
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

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
  const {
    view,
    navigate,
    library,
    tasks,
    catalog,
    catalogError,
    catalogLoading,
    config,
    appInfo,
    launcherUpdate,
    demoMode
  } = useApp()

  const activeDownloads = tasks.filter((task) => !isTerminalPhase(task.phase)).length
  const relayState = catalogError
    ? 'offline'
    : catalogLoading
      ? 'connecting'
      : catalog
        ? 'online'
        : 'idle'
  const relayLabel =
    relayState === 'offline'
      ? 'Relay unavailable'
      : relayState === 'connecting'
        ? 'Contacting relay'
        : relayState === 'online'
          ? demoMode
            ? 'Demo session'
            : 'Relay online'
          : 'Relay idle'

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

      <div className="relay-card">
        <div className="relay-card-top">
          <span className={`status-dot ${relayState}`} />
          <span>{relayLabel}</span>
        </div>
        <div className="relay-host" title={config?.backendUrl}>
          {demoMode ? 'Browser preview' : hostFromUrl(config?.backendUrl)}
        </div>
        <div className="relay-note">
          {relayState === 'offline'
            ? 'Check the relay URL in Settings.'
            : demoMode
              ? 'Sample products and simulated installs.'
              : 'Releases come from GitHub; the relay only resolves them.'}
        </div>
      </div>

      <div className="sidebar-foot">
        <span>MCM98 Launcher</span>
        <span className="mono">v{appInfo?.version ?? '0.3.0'}</span>
      </div>
    </aside>
  )
}
