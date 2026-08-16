/**
 * Intel CLI — `npm run intel -w core`.
 *
 * Subcommands:
 *   export              merge local sanitized intel into data/intel-feed.json (Phase 5A)
 *   publish             publish local intel entries to Nostr relays (Phase 5B)
 *   subscribe           watch Nostr relays for community intel (Phase 5B)
 *   keygen              generate a dedicated intel keypair
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadDotEnv } from '../config.js';
import { Logger } from '../logger.js';
import { JdStore } from '../jd/store.js';
import { buildSharedIntel } from '../jd/sanitize.js';
import { exportIntel } from './export.js';
import { generateIntelKey, publishIntel, subscribeIntel } from './nostr.js';

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig();
  const log = new Logger(cfg.logLevel, 'intel');
  const cmd = process.argv[2] ?? 'export';
  const store = new JdStore(join(cfg.configDir, 'data'), log.child('store'));

  switch (cmd) {
    case 'export': {
      // Repo root = core/.. by default; overridable via second arg
      const repoRoot = process.argv[3] ?? join(process.cwd(), '..');
      const feedPath = join(repoRoot, 'data', 'intel-feed.json');
      const result = exportIntel(store, feedPath, log);
      console.log(`exported ${result.exported} entries; feed now has ${result.total}`);
      break;
    }
    case 'publish': {
      const nostr = cfg.intel.nostr;
      if (!nostr?.privateKey) {
        console.error('intel.nostr.privateKey missing — run "npm run intel -w core keygen" first, then add it to config.json.');
        process.exit(1);
      }
      let published = 0;
      for (const record of store.listRecent(1000)) {
        const reports = store.getReports(record.jobUid);
        if (!record.tags && reports.length === 0) continue;
        await publishIntel(buildSharedIntel(record, reports), nostr, log);
        published += 1;
      }
      console.log(`published ${published} entries`);
      break;
    }
    case 'subscribe': {
      const nostr = cfg.intel.nostr;
      if (!nostr) {
        console.error('intel.nostr not configured (add relays to config.json).');
        process.exit(1);
      }
      const received = await subscribeIntel(
        nostr,
        (entry) => console.log(`${entry.jobUid} tags=${entry.tags?.summary ?? ''} reports=${entry.reports.length}`),
        log,
        20000,
      );
      console.log(`received ${received} community entries`);
      break;
    }
    case 'keygen': {
      const key = generateIntelKey();
      console.log('Add this to ~/.tomi-job-hunt/config.json:');
      console.log(JSON.stringify({ intel: { nostr: { privateKey: key.privateKey } } }, null, 2));
      console.log(`Public key: ${key.publicKey}`);
      console.log('⚠️  Use this key ONLY for intel sharing.');
      break;
    }
    default:
      console.error(`Unknown subcommand: ${cmd}. Valid: export | publish | subscribe | keygen`);
      process.exit(1);
  }
}

// CLI entry (guarded so tests can import without executing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`intel failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
