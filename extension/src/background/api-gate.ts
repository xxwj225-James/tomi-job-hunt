/**
 * Cross-tab slot allocator for the ONE BOSS endpoint the extension ever calls
 * (`/wapi/zpgeek/job/detail.json`, on an explicit 分析 click).
 *
 * Each content script used to rate-limit itself, so the limit was really "15s
 * per tab, no matter how many tabs" — ten open BOSS tabs meant ten windows and
 * the busiest sessions were the loosest. BOSS reads exactly that pattern as
 * automation (see the risk-control note in content/zhipin.ts), so the clock
 * lives here instead: one instance, shared by every tab, and persisted to
 * chrome.storage.session so an SW idle-sleep does not hand out a free slot.
 *
 * Requests to a challenged account cannot be taken back, so failure to reach
 * storage DENIES the slot: the caller falls back to DOM-only extraction, which
 * costs nothing but a slightly less polished JD.
 */

/** Minimum spacing between two BOSS API calls, across all tabs. */
export const GLOBAL_MIN_INTERVAL_MS = 60_000;

const SLOT_KEY = 'tomihunt-api-slot-at';

export interface SlotResult {
  ok: boolean;
  /** Epoch ms of the last granted slot (0 when nothing has been granted yet). */
  at: number;
}

/**
 * Pure decision — exported for tests. `lastAt` is when a slot was last granted.
 */
export function nextSlot(lastAt: number, now: number, minIntervalMs = GLOBAL_MIN_INTERVAL_MS): SlotResult {
  if (!Number.isFinite(lastAt) || lastAt <= 0) return { ok: true, at: now };
  return now - lastAt >= minIntervalMs ? { ok: true, at: now } : { ok: false, at: lastAt };
}

async function readLastAt(): Promise<number> {
  try {
    const data = await chrome.storage.session.get(SLOT_KEY);
    const value = data[SLOT_KEY];
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

async function writeLastAt(at: number): Promise<boolean> {
  try {
    await chrome.storage.session.set({ [SLOT_KEY]: at });
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialized so two tabs asking in the same millisecond cannot both read a
 * stale timestamp and both be granted the same window.
 */
let queue: Promise<unknown> = Promise.resolve();

function grant(): Promise<SlotResult> {
  const run = queue.then(async (): Promise<SlotResult> => {
    const lastAt = await readLastAt();
    const res = nextSlot(lastAt, Date.now());
    if (!res.ok) return res;
    return (await writeLastAt(res.at)) ? res : { ok: false, at: lastAt };
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Content script asks: `{type:'tomi-api-slot'}` → `{ok, at}`. */
export function installApiGate(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || (msg as { type?: string }).type !== 'tomi-api-slot') return undefined;
    void grant().then(sendResponse);
    return true; // async response
  });
}
