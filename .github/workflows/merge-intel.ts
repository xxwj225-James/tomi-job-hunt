/**
 * Aggregation step for the nightly intel-feed workflow: merges R2
 * submissions (.tmp-submissions.jsonl) into data/intel-feed.json.
 * Rejects entries carrying raw JD text or personal data (compliance moat).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeFeed, type IntelFeed, FEED_SCHEMA_VERSION } from '../../core/src/intel/export.js';
import type { SharedIntel } from '../../core/src/jd/schema.js';

const FEED_PATH = join(process.cwd(), 'data', 'intel-feed.json');
const SUBMISSIONS_PATH = join(process.cwd(), '.tmp-submissions.jsonl');

function parseSubmissions(): SharedIntel[] {
  let raw = '';
  try {
    raw = readFileSync(SUBMISSIONS_PATH, 'utf8');
  } catch {
    return [];
  }
  const entries: SharedIntel[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as SharedIntel & { requirements?: string; hrName?: string };
      if (entry.requirements || entry.hrName) continue; // never merge raw JD / PII
      if (typeof entry.jobUid !== 'string' || !Array.isArray(entry.reports)) continue;
      entries.push({
        jobUid: entry.jobUid,
        source: entry.source,
        capturedAt: entry.capturedAt ?? new Date().toISOString(),
        tags: entry.tags ?? null,
        reports: entry.reports,
      });
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

const submissions = parseSubmissions();
let existing: SharedIntel[] = [];
try {
  existing = (JSON.parse(readFileSync(FEED_PATH, 'utf8')) as IntelFeed).entries ?? [];
} catch {
  existing = [];
}
const merged = mergeFeed(existing, submissions);
const feed: IntelFeed = {
  schemaVersion: FEED_SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  entries: merged,
};
writeFileSync(FEED_PATH, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
console.log(`merged ${submissions.length} submissions; feed has ${merged.length} entries`);
