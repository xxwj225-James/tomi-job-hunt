/**
 * Intel feed export — the Phase 5A "zero-infrastructure" shared feed.
 *
 * Only structured, sanitized content ever leaves the machine:
 * buildSharedIntel (tags + reports) — raw JD text / HR names / URLs are
 * excluded by construction. The feed merges entries by jobUid so repeated
 * exports from different days accumulate rather than overwrite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSharedIntel } from '../jd/sanitize.js';
import type { SharedIntel } from '../jd/schema.js';
import type { JdStore } from '../jd/store.js';
import type { Logger } from '../logger.js';

export const FEED_SCHEMA_VERSION = 1;

export interface IntelFeed {
  schemaVersion: number;
  updatedAt: string;
  entries: SharedIntel[];
}

/** Dedupe key for reports: type + ts + (evidence hash if present). */
function reportKey(r: SharedIntel['reports'][number]): string {
  return `${r.type}|${r.ts}|${r.evidenceHash ?? ''}`;
}

/** Merges new entries into the existing feed (by jobUid). */
export function mergeFeed(existing: SharedIntel[], incoming: SharedIntel[]): SharedIntel[] {
  const byUid = new Map<string, SharedIntel>();
  for (const entry of [...existing, ...incoming]) {
    const prev = byUid.get(entry.jobUid);
    if (!prev) {
      byUid.set(entry.jobUid, entry);
      continue;
    }
    const seen = new Set(prev.reports.map(reportKey));
    const mergedReports = [
      ...prev.reports,
      ...entry.reports.filter((r) => !seen.has(reportKey(r))),
    ];
    byUid.set(entry.jobUid, {
      ...prev,
      // newest tags win (they come from the latest capture)
      tags: entry.tags ?? prev.tags,
      reports: mergedReports,
    });
  }
  return [...byUid.values()].sort((a, b) => a.jobUid.localeCompare(b.jobUid));
}

/**
 * Exports sanitized intel from the local JD store and merges it into the
 * repo's data/intel-feed.json. Entries without tags AND without reports are
 * skipped (nothing structured to share).
 */
export function exportIntel(
  store: JdStore,
  feedPath: string,
  log: Logger,
): { exported: number; total: number } {
  const incoming: SharedIntel[] = [];
  for (const record of store.listRecent(1000)) {
    const reports = store.getReports(record.jobUid);
    if (!record.tags && reports.length === 0) continue;
    incoming.push(buildSharedIntel(record, reports));
  }

  let existing: SharedIntel[] = [];
  if (existsSync(feedPath)) {
    try {
      const parsed = JSON.parse(readFileSync(feedPath, 'utf8')) as IntelFeed;
      existing = parsed.entries ?? [];
    } catch (err) {
      log.warn(`intel: existing feed unreadable (${(err as Error).message}), starting fresh`);
    }
  }

  const merged = mergeFeed(existing, incoming);
  mkdirSync(join(feedPath, '..'), { recursive: true });
  const feed: IntelFeed = {
    schemaVersion: FEED_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: merged,
  };
  writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  log.info(`intel: exported ${incoming.length} local entries → feed has ${merged.length} total (${feedPath})`);
  return { exported: incoming.length, total: merged.length };
}
