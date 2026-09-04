/**
 * Session registry — Target_ID ↔ owning agent connection.
 *
 * One chat target can be open in several tabs; the gateway keeps the newest
 * report (跨 Tab 去重). Session lifecycle is bound to the connection: a dead
 * connection marks all its sessions offline, and a periodic sweep prunes
 * offline sessions after a grace window. This is browser-crash-safe — it does
 * not rely on chrome.tabs.onRemoved/onUpdated, which the extension cannot
 * always guarantee.
 */
import type { SessionInfo, SessionStatus } from './types.js';

export interface SessionEntry {
  targetId: string;
  /** The WS connection id that owns this session (agent connection). */
  connectionId: string;
  tabId?: number;
  /** Epoch ms of the last upsert/touch (heartbeat). */
  lastSeen: number;
  status: SessionStatus;
  /** Set when the owning connection died; used by prune(). */
  offlineSince?: number;
}

export class SessionRegistry {
  private readonly byTarget = new Map<string, SessionEntry>();

  /** Insert or refresh a session. Newest report wins (cross-tab dedup). */
  upsert(targetId: string, connectionId: string, tabId: number | undefined, now: number): SessionEntry {
    const entry: SessionEntry = {
      targetId,
      connectionId,
      tabId,
      lastSeen: now,
      status: 'online',
      offlineSince: undefined,
    };
    this.byTarget.set(targetId, entry);
    return entry;
  }

  remove(targetId: string): boolean {
    return this.byTarget.delete(targetId);
  }

  get(targetId: string): SessionEntry | undefined {
    return this.byTarget.get(targetId);
  }

  /** Refresh lastSeen and bring the session back online (heartbeat / re-register). */
  touch(targetId: string, now: number): void {
    const entry = this.byTarget.get(targetId);
    if (entry) {
      entry.lastSeen = now;
      entry.status = 'online';
      entry.offlineSince = undefined;
    }
  }

  /** All sessions owned by a (now dead) connection become offline. */
  markOffline(connectionId: string, now: number): void {
    for (const entry of this.byTarget.values()) {
      if (entry.connectionId === connectionId) {
        entry.status = 'offline';
        entry.offlineSince ??= now;
      }
    }
  }

  /** Remove offline sessions idle longer than graceMs. Returns count removed. */
  prune(now: number, graceMs: number): number {
    let removed = 0;
    for (const [targetId, entry] of this.byTarget) {
      if (entry.status === 'offline' && entry.offlineSince !== undefined && now - entry.offlineSince >= graceMs) {
        this.byTarget.delete(targetId);
        removed += 1;
      }
    }
    return removed;
  }

  /** Every session owned by a connection (agent-side heartbeat/close bookkeeping). */
  byConnection(connectionId: string): SessionEntry[] {
    return [...this.byTarget.values()].filter((entry) => entry.connectionId === connectionId);
  }

  size(): number {
    return this.byTarget.size;
  }

  snapshot(): SessionInfo[] {
    return [...this.byTarget.values()].map((entry) => ({
      targetId: entry.targetId,
      tabId: entry.tabId,
      status: entry.status,
      lastSeen: entry.lastSeen,
    }));
  }
}
