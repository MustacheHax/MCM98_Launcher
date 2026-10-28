export const IPC = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  chooseInstallRoot: 'config:choose-install-root',
  testBackend: 'backend:test',
  getAppInfo: 'app:info',
  fetchCatalog: 'catalog:fetch',
  getLauncherUpdate: 'updater:get',
  checkLauncherUpdate: 'updater:check',
  downloadLauncherUpdate: 'updater:download',
  installLauncherUpdate: 'updater:install',

  listLibrary: 'library:list',
  startInstall: 'install:start',
  cancelInstall: 'install:cancel',
  getTasks: 'install:list',
  clearFinishedTasks: 'install:clear-finished',
  uninstall: 'library:uninstall',

  launch: 'launch:start',
  getRunning: 'launch:running',

  openPath: 'shell:open-path',
  openExternal: 'shell:open-external',

  tasksChanged: 'event:tasks',
  libraryChanged: 'event:library',
  runningChanged: 'event:running',
  launcherUpdateChanged: 'event:launcher-update'
} as const
