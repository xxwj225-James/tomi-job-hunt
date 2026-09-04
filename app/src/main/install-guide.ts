/**
 * Extension placement for the packaged app (dev mode is a no-op).
 *
 * Browsers refuse external programs silently installing an unpacked extension,
 * so we do the closest legal thing: copy the bundled extension bundle
 * (resources/extension) into a STABLE fixed directory
 * %LOCALAPPDATA%\TomiHunt\extension and guide the user through a one-time
 * "chrome://extensions → Developer mode → Load unpacked". The path never
 * changes across App updates — overwriting the same dir keeps the extension's
 * identity, so after an App update users only click 🔄 refresh on that page.
 *
 * A `.marker` (fingerprint of the bundle) makes the copy idempotent: unchanged
 * bundle → nothing to do; new bundle → clear + recopy.
 */
import { app } from 'electron';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { appLog } from './core-host';

export interface ExtInfo {
  /** Fixed dir holds a bundle matching the packaged one (ready to load). */
  prepared: boolean;
  /** Absolute fixed dir — '' in dev or when nothing is bundled. */
  dir: string;
  /** manifest.version of the bundle in the fixed dir ('' when not prepared). */
  version: string;
  /** True when ensureExtension() actually (re)wrote the dir on this call. */
  changed: boolean;
}

const MARKER = '.marker';

export function extensionFixedDir(): string {
  const local = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local');
  return join(local, 'TomiHunt', 'extension');
}

function bundleManifestVersion(src: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')) as { version?: string };
    return typeof raw.version === 'string' ? raw.version : null;
  } catch {
    return null;
  }
}

/** Cheap content fingerprint: version + file count + total bytes (recursive). */
function fingerprint(dir: string): string {
  let count = 0;
  let bytes = 0;
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        count += 1;
        bytes += statSync(p).size;
      }
    }
  };
  walk(dir);
  return `${bundleManifestVersion(dir) ?? '?'}|${count}|${bytes}`;
}

function copyDir(src: string, dst: string): void {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, ent.name);
    const t = join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, t);
    else if (ent.isFile()) copyFileSync(s, t);
  }
}

/**
 * Ensures the fixed extension dir matches the packaged bundle. Returns current
 * state — call at startup and again lazily from 'ext:info'.
 */
export function ensureExtension(): ExtInfo {
  if (!app.isPackaged) return { prepared: false, dir: '', version: '', changed: false };
  const src = join(process.resourcesPath, 'extension');
  if (!existsSync(join(src, 'manifest.json'))) {
    appLog(`install-guide: no bundled extension at ${src}`);
    return { prepared: false, dir: '', version: '', changed: false };
  }
  const target = extensionFixedDir();
  try {
    const version = bundleManifestVersion(src) ?? '';
    const fp = fingerprint(src);
    const markerPath = join(target, MARKER);
    const upToDate =
      existsSync(markerPath) && existsSync(join(target, 'manifest.json')) && readFileSync(markerPath, 'utf8') === fp;
    let changed = false;
    if (upToDate) {
      appLog(`install-guide: extension up to date at ${target} (v${version})`);
    } else {
      copyDir(src, target);
      writeFileSync(markerPath, fp, 'utf8');
      changed = true;
      appLog(`install-guide: extension placed at ${target} (v${version})`);
    }
    return { prepared: true, dir: target, version, changed };
  } catch (err) {
    appLog(`install-guide error: ${err instanceof Error ? err.message : String(err)}`);
    return { prepared: false, dir: '', version: '', changed: false };
  }
}
