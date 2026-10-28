import { useEffect, useState } from 'react'
import type { HealthResponse, LauncherConfig } from '@shared/types'
import { errorMessage, getLauncher } from '../api'
import { useApp } from '../state'
import {
  formatBytes,
  formatDate,
  formatSpeed,
  launcherReleaseLabel,
  platformLabel
} from '../utils'
import { PageHeader } from './PageHeader'
import { Icon, type IconName } from './Icons'
import { ThemePicker } from './ThemePicker'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; message: string }

type TabId = 'general' | 'appearance' | 'library' | 'connection' | 'updates' | 'about'

const TABS: Array<{ id: TabId; label: string; icon: IconName; description: string }> = [
  {
    id: 'general',
    label: 'General',
    icon: 'settings',
    description: 'Choose how the launcher looks and behaves every day.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'palette',
    description: 'Theme families that change typography, corners, and texture — not just colour.'
  },
  {
    id: 'library',
    label: 'Library',
    icon: 'folder',
    description: 'Choose where downloaded builds live on this computer.'
  },
  {
    id: 'connection',
    label: 'Connection',
    icon: 'catalog',
    description: 'The relay resolves GitHub releases for the catalog.'
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: 'refresh',
    description: 'Launcher and product update checks, downloads, and installs.'
  },
  {
    id: 'about',
    label: 'About',
    icon: 'monitor',
    description: 'Release and library information for this machine.'
  }
]

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

interface SettingToggleProps {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange
}: SettingToggleProps): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'is-on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const {
    config,
    appInfo,
    library,
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

  const [tab, setTab] = useState<TabId>('general')
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl ?? '')
  const [installRoot, setInstallRoot] = useState(config?.installRoot ?? '')
  const [saving, setSaving] = useState(false)
  const [prefBusy, setPrefBusy] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    setBackendUrl(config?.backendUrl ?? '')
    setInstallRoot(config?.installRoot ?? '')
  }, [config?.backendUrl, config?.installRoot])

  const urlError = validateUrl(backendUrl)
  const rootError = installRoot.trim() ? null : 'Choose an install folder.'
  const nextTab = TABS.find((item) => item.id === tab)
  const dirty = Boolean(
    config &&
      (backendUrl.trim() !== config.backendUrl || installRoot.trim() !== config.installRoot)
  )

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
  const releaseLabel = launcherReleaseLabel(
    launcherUpdate?.latestVersion ?? null,
    launcherUpdate?.releaseName ?? null
  )
  const updateMessage = (() => {
    if (!launcherUpdate || launcherUpdate.state === 'idle') return 'Not checked yet.'
    if (launcherUpdate.state === 'checking') return 'Checking GitHub releases…'
    if (launcherUpdate.state === 'available') {
      if (updateProgress?.phase === 'downloading') {
        const speed =
          updateProgress.speedBytesPerSec > 0
            ? ` · ${formatSpeed(updateProgress.speedBytesPerSec)}`
            : ''
        return `Downloading ${releaseLabel} · ${updatePercent}%${speed}.`
      }
      if (updateProgress?.phase === 'verifying') return 'Verifying the downloaded update…'
      if (updateProgress?.phase === 'ready') {
        return `${releaseLabel} is downloaded. Restart the launcher to install it.`
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
      return `${releaseLabel} is available. You are on v${launcherUpdate.currentVersion}.${
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

  const updatePreference = async (
    key: string,
    patch: Partial<LauncherConfig>
  ): Promise<void> => {
    if (!config || prefBusy) return
    setPrefBusy(key)
    try {
      await saveSettings(patch)
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setPrefBusy(null)
    }
  }

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

  const totalSize = library.reduce((sum, product) => sum + product.sizeBytes, 0)
  const prefsDisabled = prefBusy !== null

  return (
    <div className="view settings-view">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description={nextTab?.description ?? ''}
        actions={
          <div className="header-actions">
            {dirty && <span className="unsaved-chip">Unsaved</span>}
            <button
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      />

      <div className="settings-shell">
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((item) => {
            const active = item.id === tab
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`settings-tab-${item.id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${item.id}`}
                className={`settings-tab ${active ? 'is-active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
                {item.id === 'updates' && updateAvailable && (
                  <span className="settings-tab-dot" aria-label="Update available" />
                )}
              </button>
            )
          })}
        </div>

        <div
          className="settings-tab-body"
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
        >
          {tab === 'general' && (
            <div className="settings-stack">
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="monitor" size={18} />
                  </span>
                  <div>
                    <h2>Window layout</h2>
                    <p>
                      Compact is the default: an icon rail and denser cards in a smaller window.
                      Full gives every section more room. Switching resizes the launcher now.
                    </p>
                  </div>
                </div>

                <div className="layout-options" role="radiogroup" aria-label="Window layout">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={config?.layout === 'compact'}
                    className={`layout-option ${config?.layout === 'compact' ? 'is-active' : ''}`}
                    onClick={() => void updatePreference('layout', { layout: 'compact' })}
                    disabled={prefsDisabled}
                  >
                    <span className="layout-preview is-compact" aria-hidden="true">
                      <span className="lp-rail" />
                      <span className="lp-window">
                        <span className="lp-bar" />
                        <span className="lp-body">
                          <span className="lp-block" />
                          <span className="lp-block" />
                          <span className="lp-block" />
                        </span>
                      </span>
                    </span>
                    <span className="layout-option-copy">
                      <strong>Compact</strong>
                      <span>Paradox-style shell. 1080 × 700, icon rail, tighter spacing.</span>
                    </span>
                    {config?.layout === 'compact' && (
                      <span className="theme-check" aria-hidden="true">
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={config?.layout === 'full'}
                    className={`layout-option ${config?.layout === 'full' ? 'is-active' : ''}`}
                    onClick={() => void updatePreference('layout', { layout: 'full' })}
                    disabled={prefsDisabled}
                  >
                    <span className="layout-preview is-full" aria-hidden="true">
                      <span className="lp-rail" />
                      <span className="lp-window">
                        <span className="lp-bar" />
                        <span className="lp-body">
                          <span className="lp-block" />
                          <span className="lp-block" />
                          <span className="lp-block" />
                          <span className="lp-block" />
                        </span>
                      </span>
                    </span>
                    <span className="layout-option-copy">
                      <strong>Full</strong>
                      <span>The original roomier layout. 1340 × 860 with the labelled sidebar.</span>
                    </span>
                    {config?.layout === 'full' && (
                      <span className="theme-check" aria-hidden="true">
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </button>
                </div>
              </section>

              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="spark" size={18} />
                  </span>
                  <div>
                    <h2>Startup</h2>
                    <p>What appears when the launcher opens, and how much motion it uses.</p>
                  </div>
                </div>

                <div className="setting-list">
                  <div className="setting-row">
                    <div className="setting-copy">
                      <span className="setting-label">Open to</span>
                      <p>The view shown every time the launcher starts.</p>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Start view">
                      {(
                        [
                          ['library', 'Library'],
                          ['catalog', 'Catalog'],
                          ['downloads', 'Downloads']
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={config?.startView === value}
                          className={`segmented-option ${
                            config?.startView === value ? 'is-active' : ''
                          }`}
                          disabled={prefsDisabled}
                          onClick={() => void updatePreference('startView', { startView: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <SettingToggle
                    label="Boot splash"
                    description="Play the MCM98 animation while the launcher boots. Applies next launch."
                    checked={config?.showSplash ?? true}
                    disabled={prefsDisabled}
                    onChange={(checked) => void updatePreference('showSplash', { showSplash: checked })}
                  />
                  <SettingToggle
                    label="Interface animations"
                    description="Transitions, hover lifts, and the animated splash. Turning this off also stills the splash."
                    checked={config?.animations ?? true}
                    disabled={prefsDisabled}
                    onChange={(checked) =>
                      void updatePreference('animations', { animations: checked })
                    }
                  />
                  <SettingToggle
                    label="Launch when I sign in"
                    description={
                      appInfo?.isPackaged
                        ? 'Start MCM98 Launcher automatically when you sign in to this computer.'
                        : 'Available in the installed launcher. Development builds are not registered with the OS.'
                    }
                    checked={config?.launchAtLogin ?? false}
                    disabled={prefsDisabled || !appInfo?.isPackaged}
                    onChange={(checked) =>
                      void updatePreference('launchAtLogin', { launchAtLogin: checked })
                    }
                  />
                </div>
              </section>

              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="trash" size={18} />
                  </span>
                  <div>
                    <h2>Safety</h2>
                    <p>Confirmations that keep an accidental click from removing a build.</p>
                  </div>
                </div>

                <div className="setting-list">
                  <SettingToggle
                    label="Confirm before uninstalling"
                    description="Ask for confirmation before deleting an installed game or app. Turning this off makes uninstall immediate."
                    checked={config?.confirmUninstall ?? true}
                    disabled={prefsDisabled}
                    onChange={(checked) =>
                      void updatePreference('confirmUninstall', { confirmUninstall: checked })
                    }
                  />
                </div>
              </section>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="settings-stack">
              <section className="panel settings-panel appearance-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="palette" size={18} />
                  </span>
                  <div>
                    <h2>Theme family</h2>
                    <p>
                      Ten complete themes, not just palettes. Typography, corners, borders, and
                      textures change with each family. Your choice is saved to this machine.
                    </p>
                  </div>
                </div>
                <ThemePicker />
              </section>
            </div>
          )}

          {tab === 'library' && (
            <div className="settings-stack">
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="folder" size={18} />
                  </span>
                  <div>
                    <h2>Install library</h2>
                    <p>
                      Each product gets its own folder here. Changing the location does not move
                      builds that are already installed.
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
                    Open install folder
                  </button>
                  <span className="settings-note mono">
                    {library.length} installed · {formatBytes(totalSize)} on disk
                  </span>
                </div>
              </section>
            </div>
          )}

          {tab === 'connection' && (
            <div className="settings-stack">
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="catalog" size={18} />
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
                    placeholder="https://mcm98-launcher.onrender.com"
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
            </div>
          )}

          {tab === 'updates' && (
            <div className="settings-stack">
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Icon name="refresh" size={18} />
                  </span>
                  <div>
                    <h2>Launcher updates</h2>
                    <p>
                      MCM98 Launcher updates itself from its own GitHub releases, then restarts.
                      Downloads are verified before they are applied.
                    </p>
                  </div>
                </div>

                <div className="setting-list">
                  <SettingToggle
                    label="Check automatically"
                    description="Check the launcher's releases on startup and every six hours. Manual checks always work."
                    checked={config?.autoCheckLauncher ?? true}
                    disabled={prefsDisabled}
                    onChange={(checked) =>
                      void updatePreference('autoCheckLauncher', { autoCheckLauncher: checked })
                    }
                  />
                  <SettingToggle
                    label="Refresh product updates"
                    description="Re-resolve the catalog when the window regains focus and every 30 minutes."
                    checked={config?.autoCheckProducts ?? true}
                    disabled={prefsDisabled}
                    onChange={(checked) =>
                      void updatePreference('autoCheckProducts', { autoCheckProducts: checked })
                    }
                  />
                </div>

                <div className="launcher-update-panel">
                  <div className="launcher-update-head">
                    <span className={`status-dot ${updateTone}`} />
                    <span>Launcher update</span>
                    <span className="mono">v{appInfo?.version ?? '0.3.0'}</span>
                  </div>
                  <p>{updateMessage}</p>
                  {updateAvailable && updateBusy && (
                    <div
                      className={`progress ${
                        updateProgress?.phase === 'verifying' ? 'indeterminate' : ''
                      }`}
                    >
                      <span
                        style={{
                          width: `${
                            updateProgress?.phase === 'downloading' ? updatePercent : 100
                          }%`
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
              </section>
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-stack">
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
                    <dd className="mono">v{appInfo?.version ?? '0.3.0'}</dd>
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

                <div className="about-path">
                  <span className="field-label">Data folder</span>
                  <code>{appInfo?.dataRoot ?? '—'}</code>
                </div>
                <div className="about-path">
                  <span className="field-label">Launcher log</span>
                  <code>{appInfo?.logPath ?? '—'}</code>
                </div>

                <div className="settings-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => void openDataFolder()}>
                    <Icon name="folder" size={14} />
                    Open data folder
                  </button>
                  {launcherUpdate?.releaseUrl && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void openExternal(launcherUpdate.releaseUrl as string)}
                    >
                      <Icon name="external" size={14} />
                      Latest release
                    </button>
                  )}
                </div>
              </section>

              {demoMode && (
                <section className="panel demo-panel">
                  <span className="demo-pill">Demo data</span>
                  <h3>Browser preview</h3>
                  <p>
                    This page is running outside Electron, so installs, launches, window sizing,
                    and connection tests are simulated. Run <code>npm run dev</code> to use the
                    real launcher.
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
