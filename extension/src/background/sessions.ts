/**
 * Live chat-session registry in the SW.
 *
 * Chat content scripts report which JD chat is open ({type:'tomi-session'}
 * upsert/remove). We stamp sender.tab.id, keep a targetId → tabId map in
 * chrome.storage.session (survives SW idle-sleeps), and push upserts to the
 * gateway — the gateway replies `pending` to sends for offline targets and
 * flushes them the instant this upsert registers, which is what makes the
 * desktop app's "send to a tab that hasn't been open yet" work.
 *
 * A content-script ack ({type:'tomi-ack'}) is simply forwarded to the gateway
 * to answer the matching requestId.
 */
import { sendAck, sendSession } from './ws-client.js';

const SESSION_KEY = 'tomihunt-agent-sessions';

interface PersistedEntry {
  targetId: string;
  tabId: number;
}

const map = new Map<string, number>(); // targetId → tabId

async function persist(): Promise<void> {
  const entries: PersistedEntry[] = [...map.entries()].map(([targetId, tabId]) => ({ targetId, tabId }));
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: entries });
  } catch {
    // best-effort — the in-memory map still drives this SW lifetime
  }
}

/** Restores the map from the previous SW lifetime (tabId still valid). */
export async function loadSessions(): Promise<void> {
  map.clear();
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    const entries = (data[SESSION_KEY] as PersistedEntry[] | undefined) ?? [];
    for (const e of entries) {
      if (typeof e.targetId === 'string' && typeof e.tabId === 'number') map.set(e.targetId, e.tabId);
    }
  } catch {
    /* empty registry */
  }
}

export function listSessionIds(): string[] {
  return [...map.keys()];
}

export function tabIdFor(targetId: string): number | undefined {
  return map.get(targetId);
}

async function upsert(targetId: string, tabId: number | undefined): Promise<void> {
  if (tabId !== undefined) {
    map.set(targetId, tabId);
    await persist();
  }
  sendSession('upsert', targetId, tabId);
}

async function remove(targetId: string, tabId?: number): Promise<void> {
  if (tabId !== undefined && map.get(targetId) !== tabId) return; // not this tab's session
  map.delete(targetId);
  await persist();
  sendSession('remove', targetId);
}

/** Drops entries whose tab no longer exists (tab closed while SW was asleep). */
export async function pruneClosedTabs(): Promise<void> {
  let changed = false;
  for (const targetId of [...map.keys()]) {
    const tabId = map.get(targetId);
    if (tabId === undefined) continue;
    const alive = await chrome.tabs
      .get(tabId)
      .then(() => true)
      .catch(() => false);
    if (!alive) {
      map.delete(targetId);
      changed = true;
    }
  }
  if (changed) await persist();
}

/** SW → chat content: ask pages to re-announce their JD chat session. */
export async function syncChatTabs(): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const t of tabs) {
    if (t.id === undefined) continue;
    // Only pages we inject on — url is visible only with host permission,
    // so tabs without one are skipped automatically (no noisy rejections).
    if (!t.url || !/zhipin\.com|liepin\.com/i.test(t.url)) continue;
    chrome.tabs.sendMessage(t.id, { type: 'tomi-session-sync' }).catch(() => undefined);
  }
}

/**
 * Content ↔ SW channel: 'tomi-session' (upsert/remove), 'tomi-ack'
 * (dispatch result), 'tomi-session-sync-reply' (answer to a sync request).
 */
export function installMessageListener(): void {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || typeof msg !== 'object') return undefined;
    const m = msg as {
      type?: string;
      action?: string;
      targetId?: string;
      requestId?: string;
      ok?: boolean;
      error?: string;
      domSnippet?: string;
    };
    const tabId = sender.tab?.id;

    if (m.type === 'tomi-session' && typeof m.targetId === 'string') {
      if (m.action === 'remove') void remove(m.targetId, tabId);
      else void upsert(m.targetId, tabId);
      return undefined;
    }

    if (m.type === 'tomi-session-sync-reply' && typeof m.targetId === 'string') {
      void upsert(m.targetId, tabId);
      return undefined;
    }

    if (m.type === 'tomi-ack' && typeof m.requestId === 'string') {
      sendAck({
        type: 'ack',
        requestId: m.requestId,
        ok: m.ok !== false,
        error: m.error,
        domSnippet: m.domSnippet,
      });
    }
    return undefined;
  });
}

/** Tab closed → drop the session and tell the gateway (fails buffered sends). */
export function installTabListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [targetId, tid] of [...map]) {
      if (tid === tabId) {
        map.delete(targetId);
        void persist();
        sendSession('remove', targetId);
      }
    }
  });
}
