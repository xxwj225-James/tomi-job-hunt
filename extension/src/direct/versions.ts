/**
 * 简历版本管理 — chrome.storage.local CRUD. Flat array keyed by jdKey
 * (`${title}|${company}`); version numbers increment per jdKey.
 */

export const VERSIONS_KEY = 'tomihunt-resume-versions';

export interface ResumeVersion {
  id: string;
  jdKey: string; // `${title}|${company}`
  jdTitle: string;
  company: string;
  /** per-jdKey increment */
  version: number;
  markdown: string;
  createdBy: 'tailor' | 'manual';
  /** True when the tailored output passed the automated fact check (no fabricated facts). */
  verified?: boolean;
  appliedAt?: string; // ISO when the user marked it as submitted
  note?: string;
}

export async function loadVersions(): Promise<ResumeVersion[]> {
  try {
    const data = await chrome.storage.local.get(VERSIONS_KEY);
    const arr = data[VERSIONS_KEY];
    return Array.isArray(arr) ? (arr as ResumeVersion[]) : [];
  } catch {
    return [];
  }
}

export async function saveVersion(
  input: Omit<ResumeVersion, 'id' | 'version'> & { id?: string },
): Promise<ResumeVersion> {
  const all = await loadVersions();
  if (input.id) {
    const i = all.findIndex((v) => v.id === input.id);
    if (i >= 0) {
      const merged = { ...all[i], ...input };
      all[i] = merged;
      await chrome.storage.local.set({ [VERSIONS_KEY]: all });
      return merged;
    }
  }
  const rec: ResumeVersion = {
    ...input,
    id: crypto.randomUUID(),
    version: nextVersionNumber(all, input.jdKey),
  };
  all.push(rec);
  await chrome.storage.local.set({ [VERSIONS_KEY]: all });
  return rec;
}

/** Next version for a jdKey — filter by jdKey first, then max+1. */
export function nextVersionNumber(versions: ResumeVersion[], jdKey?: string): number {
  const scope = jdKey ? versions.filter((v) => v.jdKey === jdKey) : versions;
  return scope.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

export async function deleteVersion(id: string): Promise<void> {
  const all = await loadVersions();
  await chrome.storage.local.set({ [VERSIONS_KEY]: all.filter((v) => v.id !== id) });
}

export async function markApplied(id: string, ts?: string): Promise<ResumeVersion | null> {
  const all = await loadVersions();
  const i = all.findIndex((v) => v.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], appliedAt: ts ?? new Date().toISOString() };
  await chrome.storage.local.set({ [VERSIONS_KEY]: all });
  return all[i];
}
