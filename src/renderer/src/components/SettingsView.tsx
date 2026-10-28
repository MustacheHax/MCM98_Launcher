import { useEffect, useState } from 'react'
import type { HealthResponse } from '@shared/types'
import { errorMessage, getLauncher } from '../api'
import { useApp } from '../state'
import { formatBytes, formatDate, formatSpeed, platformLabel } from '../utils'
import { PageHeader } from './PageHeader'
import { Icon } from './Icons'
import { ThemePicker } from './ThemePicker'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; message: string }

function validateUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter the relay URL.'
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'The relay URL must start with http:// or https://.'
    }
  } catch {
    return 'Enter a valid URL, for example https://your-service.onrender.com'
  }
  return null
}

export function SettingsView(): JSX.Element {
  const {
    config,
    appInfo,
    saveSettings,
    openFolder,
    openDataFolder,
    launcherUpdate,
    checkLauncherUpdate,
    downloadLauncherUpdate,
    installLauncherUpdate,
    openExternal,
    toast,
    demoMode
  } = useApp()
  const bridge = getLauncher()

  const [backendUrl, setBackendUrl] = useState(config?.backendUrl ?? '')
  const [installRoot, setInstallRoot] = useState(config?.installRoot ?? '')
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    setBackendUrl(config?.backendUrl ?? '')
    setInstallRoot(config?.installRoot ?? '')
  }, [config?.backendUrl, config?.installRoot])

  const urlError = validateUrl(backendUrl)
  const rootError = installRoot.trim() ? null : 'Choose an install folder.'
  const updateChecking = launcherUpdate?.state === 'checking'
  const updateAvailable = launcherUpdate?.state === 'available'
  const updateProgress = launcherUpdate?.progress
  const updatePercent =
    updateProgress && updateProgress.totalBytes > 0
      ? Math.min(100, Math.round((updateProgress.receivedBytes / updateProgress.totalBytes) * 100))
      : 0
  const updateBusy =
    updateProgress?.phase === 'downloading' ||
    updateProgress?.phase === 'verifying' ||
    updateProgress?.phase === 'installing'
  const updateReady = updateProgress?.phase === 'ready'
  const updateTone =
    launcherUpdate?.state === 'available'
      ? 'update'
      : launcherUpdate?.state === 'checking'
        ? 'connecting'
        : launcherUpdate?.state === 'current'
          ? 'online'
          : launcherUpdate?.state === 'error'
            ? 'offline'
            : 'idle'
  const updateMessage = (() => {
    if (!launcherUpdate || launcherUpdate.state === 'idle') return 'Not checked yet.'
    if (launcherUpdate.state === 'checking') return 'Checking GitHub releases…'
    if (launcherUpdate.state === 'available') {
      if (updateProgress?.phase === 'downloading') {
        const speed =
          updateProgress.speedBytesPerSec > 0
            ? ` · ${formatSpeed(updateProgress.speedBytesPerSec)}`
            : ''
        return `Downloading v${launcherUpdate.latestVersion} · ${updatePercent}%${speed}.`
      }
      if (updateProgress?.phase === 'verifying') return 'Verifying the downloaded update…'
      if (updateProgress?.phase === 'ready') {
        return `v${launcherUpdate.latestVersion} is downloaded. Restart the launcher to install it.`
      }
      if (updateProgress?.phase === 'installing') {
        return 'Closing the launcher and applying the update…'
      }
      if (updateProgress?.phase === 'error' && updateProgress.error) {
        return updateProgress.error
      }

      const build = launcherUpdate.assetName
        ? `${launcherUpdate.assetName}${
            launcherUpdate.assetSize ? ` · ${formatBytes(launcherUpdate.assetSize)}` : ''
          }`
        : null
      return `v${launcherUpdate.latestVersion} is available. You are on v${launcherUpdate.currentVersion}.${
        build ? ` ${build}.` : ''
      }${
        launcherUpdate.publishedAt
          ? ` Published ${formatDate(launcherUpdate.publishedAt)}.`
          : ''
      }`
    }
    if (launcherUpdate.state === 'current') {
      return `You are on the latest release (v${launcherUpdate.currentVersion}).`
    }
    return launcherUpdate.error ?? 'No launcher release has been published yet.'
  })()
  const dirty = Boolean(
    config &&
      (backendUrl.trim() !== config.backendUrl || installRoot.trim() !== config.installRoot)
  )

  const handleTest = async (): Promise<void> => {
    if (urlError) return
    setTestState({ status: 'testing' })
    try {
      const health = await bridge.testBackend(backendUrl.trim())
      setTestState({ status: 'ok', health })
    } catch (error) {
      setTestState({ status: 'error', message: errorMessage(error) })
    }
  }

  const handleBrowse = async (): Promise<void> => {
    try {
      const chosen = await bridge.chooseInstallRoot()
      if (chosen) setInstallRoot(chosen)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const handleSave = async (): Promise<void> => {
    if (urlError || rootError || saving) {
      if (urlError) toast(urlError, 'error')
      if (rootError) toast(rootError, 'error')
      return
    }
    setSaving(true)
    try {
      await saveSettings({
        backendUrl: backendUrl.trim(),
        installRoot: installRoot.trim()
      })
      toast('Settings saved.', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="view settings-view">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Point the launcher at your relay and choose where downloaded builds live."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-panel appearance-panel">
            <div className="panel-heading">
              <span className="panel-icon">
                <Icon name="palette" size={18} />
              </span>
              <div>
                <h2>Appearance</h2>
                <p>
                  Ten complete themes, not just palettes. Typography, corners, borders, and
                  textures change with each family. Your choice is saved to this machine.
                </p>
              </div>
            </div>
            <ThemePicker />
          </section>

          <section className="panel settings-panel">
            <div className="panel-heading">
              <span className="panel-icon">
                <Icon name="refresh" size={18} />
              </span>
              <div>
                <h2>Relay connection</h2>
                <p>
                  The relay reads your selected repositories and resolves their newest GitHub
                  releases. It never hosts your games unless an asset is private.
                </p>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="relay-url">
                Relay URL
              </label>
              <input
                id="relay-url"
                className={`input ${urlError ? 'has-error' : ''}`}
                value={backendUrl}
                onChange={(event) => {
                  setBackendUrl(event.target.value)
                  setTestState({ status: 'idle' })
                }}
                placeholder="https://mcm98-launcher-api.onrender.com"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-invalid={Boolean(urlError)}
                aria-describedby={
                  urlError ? 'relay-url-error relay-url-hint' : 'relay-url-hint'
                }
              />
              {urlError && (
                <span className="field-error" id="relay-url-error">
                  {urlError}
                </span>
              )}
              <span className="field-hint" id="relay-url-hint">
                Use the address Render gives your web service. Free Render services sleep when
                idle, so the first request can take up to a minute.
              </span>
            </div>

            <div className="test-row">
              <button
                className="btn"
                onClick={() => void handleTest()}
                disabled={Boolean(urlError) || testState.status === 'testing' || saving}
              >
                {testState.status === 'testing' ? (
                  <>
                    <span className="spinner-small" />
                    Testing…
                  </>
                ) : (
                  <>
                    <Icon name="refresh" size={15} />
                    Test connection
                  </>
                )}
              </button>

              {testState.status === 'ok' && (
                <span className="test-result ok">
                  <Icon name="check" size={14} />
                  Relay v{testState.health.version} · {testState.health.catalogProducts}{' '}
                  products · GitHub token{' '}
                  {testState.health.githubAuthenticated ? 'configured' : 'missing'}
                </span>
              )}
              {testState.status === 'error' && (
                <span className="test-result bad">
                  <Icon name="alert" size={14} />
                  {testState.message}
                </span>
              )}
            </div>
          </section>

          <section className="panel settings-panel">
            <div className="panel-heading">
              <span className="panel-icon">
                <Icon name="folder" size={18} />
              </span>
              <div>
                <h2>Install library</h2>
                <p>
                  Each product gets its own folder here. Changing the location does not move
                  builds that are already installed.{' '}
                  {appInfo && <span className="mono">{appInfo.installRoot}</span>}
                </p>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="install-root">
                Install folder
              </label>
              <div className="input-row">
                <input
                  id="install-root"
                  className={`input ${rootError ? 'has-error' : ''}`}
                  value={installRoot}
                  onChange={(event) => setInstallRoot(event.target.value)}
                  spellCheck={false}
                  aria-invalid={Boolean(rootError)}
                  aria-describedby={
                    rootError ? 'install-root-error install-root-hint' : 'install-root-hint'
                  }
                />
                <button className="btn" onClick={() => void handleBrowse()}>
                  Browse…
                </button>
              </div>
              {rootError && (
                <span className="field-error" id="install-root-error">
                  {rootError}
                </span>
              )}
              <span className="field-hint" id="install-root-hint">
                Keep this on a drive with room for your builds. Games can be several gigabytes.
              </span>
            </div>

            <div className="settings-inline-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => void openFolder()}>
                <Icon name="folder" size={14} />
                Open saved folder
              </button>
            </div>
          </section>
        </div>

        <aside className="settings-aside">
          <section className="panel about-panel">
            <div className="panel-heading">
              <span className="panel-icon">
                <Icon name="monitor" size={18} />
              </span>
              <div>
                <h2>About this launcher</h2>
                <p>Release and library information for this machine.</p>
              </div>
            </div>

            <dl className="about-grid">
              <div>
                <dt>Version</dt>
                <dd className="mono">v{appInfo?.version ?? '0.2.0'}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{appInfo ? platformLabel(appInfo.platform) : 'Unknown'}</dd>
              </div>
              <div>
                <dt>Architecture</dt>
                <dd className="mono">{appInfo?.arch ?? '—'}</dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd>{appInfo?.isPackaged ? 'Packaged' : 'Development'}</dd>
              </div>
            </dl>

            <div className="launcher-update-panel">
              <div className="launcher-update-head">
                <span className={`status-dot ${updateTone}`} />
                <span>Launcher update</span>
                <span className="mono">v{appInfo?.version ?? '0.2.0'}</span>
              </div>
              <p>{updateMessage}</p>
              {updateAvailable && updateBusy && (
                <div
                  className={`progress ${updateProgress?.phase === 'verifying' ? 'indeterminate' : ''}`}
                >
                  <span
                    style={{
                      width: `${updateProgress?.phase === 'downloading' ? updatePercent : 100}%`
                    }}
                  />
                </div>
              )}
              <div className="test-row">
                <button
                  className="btn btn-sm"
                  onClick={() => void checkLauncherUpdate()}
                  disabled={updateChecking || updateBusy}
                >
                  <Icon name="refresh" size={14} />
                  {updateChecking ? 'Checking…' : 'Check now'}
                </button>
                {updateAvailable && updateReady && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void installLauncherUpdate()}
                  >
                    <Icon name="refresh" size={13} />
                    Restart &amp; install
                  </button>
                )}
                {updateAvailable && !updateReady && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void downloadLauncherUpdate()}
                    disabled={updateBusy}
                  >
                    <Icon name="download" size={13} />
                    {updateProgress?.phase === 'downloading'
                      ? `Downloading ${updatePercent}%`
                      : updateProgress?.phase === 'verifying'
                        ? 'Verifying…'
                        : updateProgress?.phase === 'installing'
                          ? 'Installing…'
                          : updateProgress?.phase === 'error'
                            ? 'Try again'
                            : 'Download update'}
                  </button>
                )}
                {updateAvailable && launcherUpdate?.releaseUrl && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void openExternal(launcherUpdate.releaseUrl as string)}
                  >
                    Release notes
                    <Icon name="external" size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="about-path">
              <span className="field-label">Data folder</span>
              <code>{appInfo?.dataRoot ?? '—'}</code>
            </div>
            <div className="about-path">
              <span className="field-label">Launcher log</span>
              <code>{appInfo?.logPath ?? '—'}</code>
            </div>

            <button className="btn btn-ghost btn-sm" onClick={() => void openDataFolder()}>
              <Icon name="folder" size={14} />
              Open data folder
            </button>
          </section>

          {demoMode && (
            <section className="panel demo-panel">
              <span className="demo-pill">Demo data</span>
              <h3>Browser preview</h3>
              <p>
                This page is running outside Electron, so installs, launches, and connection
                tests are simulated. Run <code>npm run dev</code> to use the real launcher.
              </p>
            </section>
          )}

          {dirty && (
            <section className="panel unsaved-panel">
              <Icon name="alert" size={16} />
              <p>You have unsaved changes.</p>
              <button className="text-button" onClick={() => void handleSave()} disabled={saving}>
                Save now
              </button>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
