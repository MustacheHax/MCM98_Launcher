import { useApp } from '../state'
import { formatDate, isTerminalPhase } from '../utils'
import { Icon } from './Icons'

function hostFromUrl(value: string | undefined): string {
  if (!value) return 'Not configured'
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

/**
 * The thin footer carries the relay health instead of a sidebar card. The
 * launcher picks its relay automatically, so the indicator only reports state;
 * hovering it (or focusing it with the keyboard) reveals the host and any last
 * error.
 */
export function StatusBar(): JSX.Element {
  const { config, appInfo, catalog, catalogError, catalogLoading, demoMode, navigate, tasks } =
    useApp()

  const stale = Boolean(catalog?.stale)
  const relayState = stale || catalogError
    ? 'offline'
    : catalogLoading
      ? 'connecting'
      : catalog
        ? 'online'
        : 'idle'
  const relayLabel = stale
    ? 'Relay offline · cached'
    : relayState === 'offline'
      ? 'Relay offline'
      : relayState === 'connecting'
        ? 'Relay connecting'
        : relayState === 'online'
          ? demoMode
            ? 'Demo session'
            : 'Relay online'
          : 'Relay idle'

  const activeDownloads = tasks.filter((task) => !isTerminalPhase(task.phase)).length
  const host = hostFromUrl(config?.backendUrl)

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <div className={`relay-status-wrap is-${relayState}`}>
          <div
            className="relay-status"
            tabIndex={0}
            aria-describedby="relay-status-detail"
            title="Relay status"
          >
            <span className={`status-dot ${relayState}`} aria-hidden="true" />
            <span className="relay-status-label">{relayLabel}</span>
          </div>

          <div className="relay-popover" id="relay-status-detail" role="tooltip">
            <div className="relay-popover-head">
              <span className={`status-dot ${relayState}`} aria-hidden="true" />
              <strong>{relayLabel}</strong>
              {demoMode && <span className="demo-pill">Demo</span>}
            </div>

            <dl className="relay-popover-grid">
              <div>
                <dt>Address</dt>
                <dd className="mono" title={config?.backendUrl}>
                  {demoMode ? 'Browser preview' : host}
                </dd>
              </div>
              {catalog && (
                <div>
                  <dt>Catalog</dt>
                  <dd>
                    {catalog.products.length} products · relay v{catalog.backendVersion}
                  </dd>
                </div>
              )}
              {catalog && (
                <div>
                  <dt>{stale ? 'Cached' : 'Updated'}</dt>
                  <dd>{formatDate(catalog.cachedAt ?? catalog.generatedAt)}</dd>
                </div>
              )}
            </dl>

            {catalogError && (
              <p className="relay-popover-error">
                <Icon name="alert" size={13} />
                <span>{catalogError}</span>
              </p>
            )}

            <p className="relay-popover-hint">
              {demoMode
                ? 'Sample products and simulated installs. Run the desktop app for a real relay.'
                : 'The launcher dials its built-in relay automatically. Settings → About shows the address and can re-test it.'}
            </p>
          </div>
        </div>

        {activeDownloads > 0 && (
          <button
            type="button"
            className="statusbar-downloads"
            onClick={() => navigate('downloads')}
            title="Open downloads"
          >
            <Icon name="download" size={12} />
            {activeDownloads} installing
          </button>
        )}
      </div>

      <div className="statusbar-right">
        <span className="statusbar-brand">MCM98 Launcher</span>
        <span className="statusbar-version mono">v{appInfo?.version ?? '0.4.6'}</span>
      </div>
    </footer>
  )
}
