/**
 * OTA version check — the Core pings the repo-hosted version.json (later:
 * GitHub Releases API) on startup, non-blocking, and surfaces the result in
 * /health + the setup page. Git-based installs also auto-pull via start.bat.
 */

/** semver-lite compare: -1 a<b, 0 equal, 1 a>b. Handles missing segments. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

export interface VersionInfo {
  version: string;
  notes?: string;
  releaseUrl?: string;
}

export async function fetchRemoteVersion(url: string, timeoutMs = 4000): Promise<VersionInfo | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { version?: string; notes?: string; releaseUrl?: string };
    if (!json.version) return null;
    return { version: json.version, notes: json.notes, releaseUrl: json.releaseUrl };
  } catch {
    return null; // offline / blocked — never block startup on the check
  }
}

export interface UpdateCheck {
  current: string;
  latest: VersionInfo | null;
  updateAvailable: boolean;
}

export function buildUpdateCheck(current: string, remote: VersionInfo | null): UpdateCheck {
  return {
    current,
    latest: remote,
    updateAvailable: remote !== null && compareVersions(remote.version, current) > 0,
  };
}
