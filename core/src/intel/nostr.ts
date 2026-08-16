/**
 * Phase 5B — permissionless intel sharing over Nostr.
 *
 * Every client generates (or configures) a keypair; publishing requires no
 * account, no token, and no server we run. Event kind 30078 (application
 * data), tag `#t: tomihunt-intel`. Content is a single sanitized
 * SharedIntel entry — structured facts only, never raw JD text.
 *
 * SECURITY: use a DEDICATED key for intel sharing. The private key stays in
 * your config dir and only signs these events.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import type { SharedIntel } from '../jd/schema.js';
import type { Logger } from '../logger.js';

export const INTEL_KIND = 30078;
export const INTEL_TAG = 'tomihunt-intel';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

export interface NostrConfig {
  relays: string[];
  privateKey?: string;
}

/** Signs and publishes one sanitized entry to the configured relays. */
export async function publishIntel(
  entry: SharedIntel,
  cfg: NostrConfig,
  log: Logger,
): Promise<string> {
  const privateKey = cfg.privateKey;
  if (!privateKey) throw new Error('intel.nostr.privateKey is not configured (hex nsec). Use a DEDICATED key.');
  const pubkey = getPublicKey(privateKey);
  const event = finalizeEvent(
    {
      kind: INTEL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', INTEL_TAG],
        ['t', INTEL_TAG],
        ['j', entry.jobUid],
      ],
      content: JSON.stringify(entry),
    },
    privateKey,
  );

  const relays = cfg.relays.length > 0 ? cfg.relays : DEFAULT_RELAYS;
  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish(relays, event));
    log.info(`nostr: published ${entry.jobUid} to ${relays.length} relays (author ${pubkey.slice(0, 8)}…)`);
  } finally {
    pool.close(relays);
  }
  return event.id;
}

/** Subscribes for `timeoutMs`, invoking onEntry per received intel event. */
export async function subscribeIntel(
  cfg: NostrConfig,
  onEntry: (entry: SharedIntel, eventId: string) => void,
  log: Logger,
  timeoutMs = 15000,
): Promise<number> {
  const relays = cfg.relays.length > 0 ? cfg.relays : DEFAULT_RELAYS;
  const pool = new SimplePool();
  let received = 0;
  try {
    const sub = pool.subscribeMany(
      relays,
      [{ kinds: [INTEL_KIND], '#t': [INTEL_TAG], limit: 50 }],
      {
        onevent: (event) => {
          try {
            const entry = JSON.parse(event.content) as SharedIntel;
            if (!entry.jobUid) return;
            received += 1;
            onEntry(entry, event.id);
          } catch {
            // not a valid intel event — ignore
          }
        },
      },
    );
    await new Promise((r) => setTimeout(r, timeoutMs));
    sub.close();
  } catch (err) {
    log.warn(`nostr: subscribe error: ${(err as Error).message}`);
  } finally {
    pool.close(relays);
  }
  return received;
}

/** Generates a fresh dedicated keypair for intel sharing. */
export function generateIntelKey(): { privateKey: string; publicKey: string } {
  const privateKey = generateSecretKey();
  return { privateKey, publicKey: getPublicKey(privateKey) };
}
