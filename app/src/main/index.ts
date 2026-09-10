/**
 * TomiHunt Agent — Electron main process.
 *
 * OS-level floating window (frame:false + alwaysOnTop) over the browser.
 * Shell only: it forks the core child process (CoreHost) and hosts the Agent
 * UI renderer, which talks REST + WS directly to core. Window state (bounds +
 * toggles) is persisted to ~/.tomi-job-hunt/app-state.json.
 *
 * Lifecycle: closing the window quits the app (no tray / no resident mode —
 * minimize keeps it on the taskbar instead). Always-open helper (formerly
 * "hide to tray") was removed per user decision.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell, type Rectangle } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { CoreHost, appLog } from './core-host';
import { ensureExtension, extensionFixedDir } from './install-guide';
import { registerUpdater } from './updater';

const configDir = process.env.TOMI_HOME ?? join(homedir(), '.tomi-job-hunt');
mkdirSync(configDir, { recursive: true });
const stateFile = join(configDir, 'app-state.json');

interface AppState {
  bounds?: Rectangle;
  alwaysOnTop?: boolean;
  autoLaunch?: boolean;
}

function loadState(): AppState {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as AppState;
  } catch {
    return {};
  }
}

function saveState(patch: Partial<AppState>): void {
  const next = { ...state, ...patch };
  try {
    writeFileSync(stateFile, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // best-effort persistence
  }
}

const DEFAULT_W = 980;
const DEFAULT_H = 660;

let state: AppState = loadState();
let win: BrowserWindow | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const coreHost = new CoreHost();

function defaultBounds(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - DEFAULT_W - 20;
  const y = workArea.y + 28;
  return { x, y, width: DEFAULT_W, height: DEFAULT_H };
}

function isValidBounds(b: Rectangle | undefined): b is Rectangle {
  if (!b) return false;
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const a = d.workArea;
    return (
      b.x < a.x + a.width &&
      b.x + b.width > a.x &&
      b.y < a.y + a.height &&
      b.y + b.height > a.y
    );
  });
}

function createWindow(): void {
  const bounds = isValidBounds(state.bounds) ? state.bounds : defaultBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: state.alwaysOnTop ?? true,
    skipTaskbar: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The float sits behind/over the browser all day while the user browses,
      // and Chromium throttles timers of hidden and occluded windows by default.
      // That silently froze the JD 库 poll (reported as "打开 JD 后 agent 没有
      // 同步"). The push channel now covers the gap, but the poll stays and must
      // keep running while the window is not focused.
      backgroundThrottling: false,
    },
  });

  // Re-emit the latest core state whenever the UI (re)loads.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('core:state', coreHost.state);
  });

  // Persist bounds (debounced) while the user drags/resizes the float.
  win.on('moved', scheduleBoundsSave);
  win.on('resized', scheduleBoundsSave);
  win.on('close', saveBounds);

  // Transparent frameless windows don't reliably fire 'ready-to-show' on all
  // GPUs/drivers, and can report isVisible()=false until their first paint.
  // A cold renderer (dev-server) load also lags a few seconds. Show on
  // ready-to-show / did-finish-load, then re-assert show() briefly until the
  // window is actually visible (bounded, ~22s cap).
  const showWindow = (): void => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', showWindow);
  win.webContents.once('did-finish-load', () => setTimeout(showWindow, 150));
  let shownOnce = false;
  const ensureVisible = (): void => {
    if (!win || win.isDestroyed() || shownOnce) return;
    if (win.isVisible()) {
      shownOnce = true;
      appLog('[diag] window shown');
      return;
    }
    win.show();
    setTimeout(ensureVisible, 800);
  };
  setTimeout(ensureVisible, 2000);
  setTimeout(() => {
    shownOnce = true; // stop the loop after ~22s regardless
  }, 22000);

  // Diagnostics: report where the float actually ended up.
  setTimeout(() => {
    if (!win) return;
    appLog(`[diag] visible=${win.isVisible()} shown=${win.isDestroyed() ? 'destroyed' : win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`);
    appLog(
      `[diag] displays=${JSON.stringify(
        screen.getAllDisplays().map((d) => ({ scale: d.scaleFactor, workArea: d.workArea, bounds: d.bounds })),
      )}`,
    );
  }, 4500);

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function scheduleBoundsSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

function saveBounds(): void {
  if (!win || win.isDestroyed()) return;
  saveState({ bounds: win.getBounds() });
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Chromium browser launch paths (Windows). chrome:// and edge:// are *internal*
// schemes — the OS has no handler for them, so shell.openExternal pops the
// Microsoft Store instead of a browser. Correct way: exec the browser and hand
// it the extensions URL as a command-line argument.
const CHROME_EXES = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
].filter((p) => p && existsSync(p));
const EDGE_EXES = [
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
].filter((p) => p && existsSync(p));

/** The OS-registered default browser's ProgId (e.g. ChromeHTML / MSEdgeHTM). */
function defaultBrowserProgId(): string | null {
  try {
    const r = spawnSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '/v', 'ProgId'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0 || !r.stdout) return null;
    const m = r.stdout.match(/ProgId\s+REG_SZ\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface ExtBrowser {
  kind: 'chrome' | 'edge';
  exe: string;
  url: string;
}

/** The dir the app copies its bundled extension to (matches install-guide.ts). */
const FIXED_EXT_DIR = extensionFixedDir();

function chromiumCandidates(): ExtBrowser[] {
  const list: ExtBrowser[] = [];
  if (CHROME_EXES[0]) list.push({ kind: 'chrome', exe: CHROME_EXES[0], url: 'chrome://extensions/' });
  if (EDGE_EXES[0]) list.push({ kind: 'edge', exe: EDGE_EXES[0], url: 'edge://extensions/' });
  return list;
}

/** Where a browser says it loaded TomiHunt from, and whether that is healthy. */
interface ExtLoad {
  browser: ExtBrowser;
  /** Load dir as recorded by the browser. */
  dir: string;
  /** 'fixed' = the dir this App keeps up to date; 'elsewhere' = outside it. */
  where: 'fixed' | 'elsewhere';
  /** Why the loaded dir cannot work ('', when it is fine). */
  problem: string;
}

/**
 * Chromium's per-profile extension registry. Modern Chromium keeps
 * extensions.settings in "Secure Preferences" — "Preferences" carries an empty
 * settings object (0 entries on Edge/Chrome, verified 2026-09). Reading only
 * "Preferences" is why the old scan never matched anything, so "打开扩展页"
 * always fell back to the default browser even with the extension loaded.
 */
const PREFS_FILES = ['Secure Preferences', 'Preferences'];

/** Manifest name check, tolerant of the title suffix in "TomiHunt — …". */
function isTomihuntManifest(raw: unknown): boolean {
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.startsWith('TomiHunt');
}

/** Reads <dir>/manifest.json and says whether it is a TomiHunt bundle. */
function manifestIsTomihunt(dir: string): boolean {
  try {
    return isTomihuntManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    return false;
  }
}

/**
 * Inspects a dir a browser loaded as an unpacked extension. Returns null when
 * it is not ours.
 *
 * The second path covers our release bundle: it is a wrapper
 * (install-extension.bat + extension/), so picking the wrapper in
 * "Load unpacked" yields a dir whose ROOT has no manifest.json — Chromium shows
 * a broken card for it. Name-matching the nested manifest is what lets us say
 * that out loud instead of leaving the user with a silently dead extension.
 */
function inspectLoadedDir(dir: string): { problem: string } | null {
  if (manifestIsTomihunt(dir)) return { problem: '' };
  if (manifestIsTomihunt(join(dir, 'extension'))) {
    return {
      problem: `该目录根下没有 manifest.json —— 真正的插件在它的 extension 子目录里，浏览器把这里当成空壳加载（卡片会显示损坏）`,
    };
  }
  return null;
}

/**
 * The Chromium that has the TomiHunt extension loaded, with the dir it loaded
 * it from. A copy in the fixed dir wins (that one is current and gets updated);
 * otherwise the first TomiHunt loaded from anywhere else is reported, so the UI
 * can tell the user their live extension is stranded outside App updates.
 */
function detectExtensionLoad(cands: ExtBrowser[]): ExtLoad | null {
  if (!FIXED_EXT_DIR || !cands.length) return null;
  const fixed = FIXED_EXT_DIR.toLowerCase();
  let stray: ExtLoad | null = null;
  for (const cand of cands) {
    const userData = join(
      process.env.LOCALAPPDATA ?? '',
      cand.kind === 'chrome' ? 'Google\\Chrome\\User Data' : 'Microsoft\\Edge\\User Data',
    );
    if (!existsSync(userData)) continue;
    let profiles: string[];
    try {
      profiles = readdirSync(userData, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const profile of profiles) {
      for (const file of PREFS_FILES) {
        const prefs = join(userData, profile, file);
        if (!existsSync(prefs)) continue;
        let settings: Record<string, { path?: string; location?: number }> | undefined;
        try {
          const json = JSON.parse(readFileSync(prefs, 'utf8')) as {
            extensions?: { settings?: Record<string, { path?: string; location?: number }> };
          };
          settings = json.extensions?.settings;
        } catch {
          continue; // locked/partial while the browser is running — try the next
        }
        if (!settings) continue;
        for (const id of Object.keys(settings)) {
          const entry = settings[id];
          const dir = entry?.path;
          // location 4 = unpacked. Web-store copies live under
          // <User Data>/<profile>/Extensions/<id>/<version> — never ours.
          if (!dir || (entry.location !== undefined && entry.location !== 4)) continue;
          if (!existsSync(dir)) continue;
          if (dir.toLowerCase() === fixed) return { browser: cand, dir, where: 'fixed', problem: '' };
          const info = inspectLoadedDir(dir);
          if (info && !stray) stray = { browser: cand, dir, where: 'elsewhere', problem: info.problem };
        }
      }
    }
  }
  return stray;
}

/**
 * Which browser gets the extensions page when NO browser has the extension yet:
 * the user's default browser when it's Chrome/Edge, else installed Chrome
 * (chrome://extensions), else installed Edge. Never opens the default homepage —
 * always the engine's extension management page.
 */
function extensionsTargetBrowser(cands: ExtBrowser[]): ExtBrowser | null {
  if (!cands.length) return null;
  const prog = (defaultBrowserProgId() ?? '').toLowerCase();
  if (prog.includes('chrome')) return cands.find((c) => c.kind === 'chrome') ?? cands[0];
  if (prog.includes('edge')) return cands.find((c) => c.kind === 'edge') ?? cands[0];
  return cands.find((c) => c.kind === 'chrome') ?? cands[0];
}

function browserLabel(b: ExtBrowser): string {
  return b.kind === 'chrome' ? 'Chrome' : 'Edge';
}

/** Windows image name of a browser exe (chrome.exe / msedge.exe). */
function browserImage(exe: string): string {
  const n = basename(exe).toLowerCase();
  return n.endsWith('.exe') ? n : `${n}.exe`;
}

/** True when any process of that image name is running (tasklist is cheap). */
function isBrowserRunning(image: string): boolean {
  try {
    const r = spawnSync('tasklist', ['/NH', '/FI', `IMAGENAME eq ${image}`], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    // A process line looks like "chrome.exe  12345 Console ...". When nothing
    // matches, tasklist prints "INFO: No tasks are running which match…".
    return r.status === 0 && /\.exe\s+\d+/i.test(r.stdout ?? '');
  } catch {
    return false;
  }
}

/**
 * Launch a browser that is NOT running yet. Passed as a cold-start URL, the
 * chrome:///edge:// value is ignored by current Chromium (it opens a plain new
 * tab instead) — the URL is carried for the case where the engine ever honours
 * it, and for older builds; the real value here is just getting a browser up
 * for the user to paste into.
 */
function coldOpenBrowser(browser: ExtBrowser): void {
  const child = spawn(browser.exe, [browser.url], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    // Exec failed (e.g. the exe moved) — retry with the other engine if any.
    const alt = chromiumCandidates().find((c) => c.kind !== browser.kind);
    if (alt) coldOpenBrowser(alt);
  });
  child.unref();
}

/**
 * Open the browser's extension management page (chrome://extensions or
 * edge://extensions).
 *
 * Security reality (verified empirically on current Chrome/Edge builds, 2026):
 * Chromium silently DROPS internal-scheme URLs given on the command line —
 * cold or warm. Launching the browser with `chrome://extensions` (or even a
 * benign `chrome://version`) opens a plain new tab and ignores the URL. So an
 * external app can never make the browser land on that page by relaunching
 * onto it; the only ways are the user typing/pasting it in the address bar, or
 * an already-loaded extension navigating to it itself. This means the old
 * "close the browser and reopen onto chrome://extensions" dance was not just
 * disruptive (it killed the user's session) but also never worked.
 *
 * So this helper never restarts anything. It picks the engine the TomiHunt
 * extension lives in (so refreshes land in the right browser), otherwise the
 * default Chromium; opens it if it is not running; copies the exact page URL
 * to the clipboard; and shows a short one-time hint to paste it into the
 * address bar (Ctrl+L → Ctrl+V → Enter).
 */
async function openExtensionsPage(): Promise<void> {
  const cands = chromiumCandidates();
  if (process.platform !== 'win32' || !cands.length) {
    // No installed/bundled engine found (incl. non-Windows). Internal schemes
    // usually have no OS handler and would hit the Store — put the URL on the
    // clipboard and explain instead.
    clipboard.writeText('chrome://extensions');
    if (win && !win.isDestroyed()) {
      await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['知道了'],
        noLink: true,
        message: '请在浏览器地址栏打开扩展管理页',
        detail: '本机未检测到 Chrome / Edge。地址已复制到剪贴板：\n\n  chrome://extensions\n\n在任意浏览器的地址栏按 Ctrl+L 粘贴并回车即可。',
      });
    }
    return;
  }

  // A browser that already has the TomiHunt extension loaded wins (so the
  // reload/refresh lands where it actually lives); otherwise the default
  // Chromium engine.
  const load = detectExtensionLoad(cands);
  const target = load?.browser ?? extensionsTargetBrowser(cands) ?? cands[0];
  const url = target.url;
  const label = browserLabel(target);
  clipboard.writeText(url);

  // A TomiHunt loaded from outside the fixed dir keeps working, but no App
  // update ever reaches it and it holds its OWN storage — the user would sit on
  // a frozen version forever without noticing. Say so where they will act.
  const stray = load && load.where === 'elsewhere' ? load : null;

  // Open it if it isn't up yet, so there's always a browser to paste into.
  // (The cold launch ignores `url` — Chromium drops it — and lands on a fresh
  // tab or the restored session, which is fine here.)
  if (!isBrowserRunning(browserImage(target.exe))) coldOpenBrowser(target);

  if (!win || win.isDestroyed()) return;
  await dialog.showMessageBox(win, {
    type: stray ? 'warning' : 'info',
    buttons: ['知道了'],
    noLink: true,
    message: stray ? `检测到插件装在别的目录 — 请在 ${label} 里处理` : `扩展管理页地址已复制 — 请在 ${label} 里粘贴打开`,
    detail:
      (stray
        ? `TomiHunt 目前在 ${label} 里是从这个目录加载的：\n\n  ${stray.dir}\n\n` +
          (stray.problem ? `问题：${stray.problem}\n\n` : '') +
          `它不在 App 管理的固定目录里，插件更新永远到不了它。请在扩展页移除那张卡片，再从下面的固定目录「加载已解压的扩展程序」：\n\n  ${FIXED_EXT_DIR}\n\n` +
          `（加载前重开 App，或点「打开插件目录」确认它已就位。）\n\n`
        : '') +
      `Chrome / Edge 出于安全限制，不允许外部程序直接打开其内部页面，因此无法为你自动跳转。\n\n` +
      `页面地址已在剪贴板：\n\n  ${url}\n\n` +
      `在 ${label} 地址栏按 Ctrl+L 粘贴并回车即可（一次即可）。之后可在该页点开「开发者模式」加载插件，或把此页固定方便以后直接点开。`,
  });
}

function registerIpc(): void {
  ipcMain.handle('core:base', () => coreHost.state.base);
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    coreDist: __dirname, // informational
  }));
  ipcMain.handle('win:alwaysOnTop', (_e, on: boolean) => {
    state.alwaysOnTop = on;
    saveState({ alwaysOnTop: on });
    win?.setAlwaysOnTop(on, 'screen-saver');
    return on;
  });
  ipcMain.handle('autoLaunch:get', () => state.autoLaunch ?? false);
  ipcMain.handle('autoLaunch:set', (_e, on: boolean) => {
    state.autoLaunch = on;
    saveState({ autoLaunch: on });
    app.setLoginItemSettings({ openAtLogin: on });
    return on;
  });

  ipcMain.on('win:action', (_e, action: 'minimize' | 'close') => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'close') win.close();
  });
  // Fixed-dir extension state (copy-on-first-run; see install-guide.ts) plus
  // what the browsers ACTUALLY loaded, so Settings can flag a stranded copy.
  ipcMain.handle('ext:info', () => {
    const info = ensureExtension();
    const load = detectExtensionLoad(chromiumCandidates());
    return {
      ...info,
      load: load
        ? { browser: browserLabel(load.browser), dir: load.dir, where: load.where, problem: load.problem }
        : null,
    };
  });

  ipcMain.on('shell:openExtensions', () => {
    void openExtensionsPage();
  });
  ipcMain.on('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.on('shell:openConfigDir', () => {
    void shell.openPath(configDir);
  });
  // Open the folder the bundled extension lives in (packaged: the fixed load
  // dir; dev: the repo's extension/dist) so "load unpacked" can pick it.
  ipcMain.on('shell:openExtDir', () => {
    const fixed = FIXED_EXT_DIR;
    const dev = join(app.getAppPath(), '..', 'extension', 'dist');
    const dir = existsSync(fixed) ? fixed : existsSync(dev) ? dev : configDir;
    void shell.openPath(dir);
  });
}

// Single instance: focus the float on a second launch instead of duplicating.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // Stable identity for the taskbar button on Windows.
    if (process.platform === 'win32') app.setAppUserModelId('com.tomihunt.agent');
    // Packaged only: place the bundled extension in its fixed load dir before
    // the UI asks for the status (dev mode no-ops).
    ensureExtension();
    registerIpc();
    registerUpdater();
    createWindow();
    coreHost.subscribe((s) => {
      appLog(`core state: ${s.kind} ${s.base ?? ''}`);
      win?.webContents.send('core:state', s);
    });
    void coreHost.start();
  });

  app.on('before-quit', () => {
    coreHost.stop();
  });

  app.on('activate', showWindow);

  // No resident/tray mode: closing the window quits the app.
  app.on('window-all-closed', () => {
    app.quit();
  });
}
