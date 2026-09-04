/**
 * OTA auto-update (electron-updater + GitHub Releases).
 *
 * Packaged builds: check on a 10s delay then every 4h, auto-download when an
 * update is found, and let the user decide when to quit+install (NSIS assisted
 * installer — electron-builder embeds the publish feed in app-update.yml, and
 * `npm run pack` emits latest.yml + .blockmap next to the installer).
 *
 * Dev builds are a no-op: handlers still answer so the Settings UI can show a
 * friendly "打包后可用", but no network calls are made.
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface UpdaterStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'not-available'
    | 'disabled'
    | 'error';
  /** New version once known (available/downloaded). */
  version?: string;
  /** Download progress 0..100 while downloading. */
  percent?: number;
  /** Human message (disabled/error). */
  message?: string;
}

const DISABLED: UpdaterStatus = { state: 'disabled', message: '当前为开发版，打包安装后才支持自动更新' };

let last: UpdaterStatus = { state: 'idle' };
let timer: NodeJS.Timeout | null = null;

function broadcast(s: UpdaterStatus): void {
  last = s;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updater:status', s);
}

/** Registers IPC + (packaged) the check loop. Call once from app.whenReady. */
export function registerUpdater(): void {
  ipcMain.handle('updater:status', () => last);
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return DISABLED;
    broadcast({ state: 'checking' });
    try {
      const result = await autoUpdater.checkForUpdates();
      // 'available'/'not-available' events fire around this; reflect the tail.
      return last;
    } catch (err) {
      const s: UpdaterStatus = { state: 'error', message: err instanceof Error ? err.message : String(err) };
      broadcast(s);
      return s;
    }
  });
  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) return DISABLED;
    try {
      broadcast({ state: 'downloading', ...(last.version ? { version: last.version } : {}), percent: 0 });
      await autoUpdater.downloadUpdate();
      return last;
    } catch (err) {
      const s: UpdaterStatus = { state: 'error', message: err instanceof Error ? err.message : String(err) };
      broadcast(s);
      return s;
    }
  });
  ipcMain.handle('updater:quitAndInstall', () => {
    if (!app.isPackaged) return false;
    autoUpdater.quitAndInstall();
    return true;
  });

  if (!app.isPackaged) {
    broadcast(DISABLED);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false; // NSIS assisted → user clicks install

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', version: last.version, percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) }),
  );

  timer = setTimeout(() => void autoUpdater.checkForUpdates(), 10_000);
  setInterval(() => void autoUpdater.checkForUpdates(), 4 * 3600 * 1000);
}

/** Test hook only — clears the scheduled startup check. */
export function _cancelUpdaterSchedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
