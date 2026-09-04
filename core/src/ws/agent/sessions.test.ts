import { describe, expect, it } from 'vitest';
import { SessionRegistry } from './sessions.js';

const T0 = 1_000_000;

describe('SessionRegistry', () => {
  it('upserts and looks up a session', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 42, T0);
    const e = reg.get('target-a');
    expect(e).toMatchObject({ targetId: 'target-a', connectionId: 'conn-1', tabId: 42, status: 'online', lastSeen: T0 });
  });

  it('dedups cross-tab: newest report for the same target wins', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 42, T0);
    reg.upsert('target-a', 'conn-2', 77, T0 + 100);
    expect(reg.size()).toBe(1);
    expect(reg.get('target-a')).toMatchObject({ connectionId: 'conn-2', tabId: 77 });
  });

  it('remove deletes the mapping', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 1, T0);
    expect(reg.remove('target-a')).toBe(true);
    expect(reg.remove('target-a')).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it('markOffline flags every session of a dead connection', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 1, T0);
    reg.upsert('target-b', 'conn-2', 2, T0);
    reg.markOffline('conn-1', T0 + 10);
    expect(reg.get('target-a')).toMatchObject({ status: 'offline', offlineSince: T0 + 10 });
    expect(reg.get('target-b')?.status).toBe('online');
  });

  it('touch restores an offline session to online', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 1, T0);
    reg.markOffline('conn-1', T0 + 10);
    reg.touch('target-a', T0 + 20);
    expect(reg.get('target-a')).toMatchObject({ status: 'online', lastSeen: T0 + 20, offlineSince: undefined });
  });

  it('prune removes offline sessions idle past the grace window', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 1, T0);
    reg.upsert('target-b', 'conn-1', 2, T0);
    reg.markOffline('conn-1', T0 + 10);
    // target-c is a live session owned by a different connection — untouched.
    reg.upsert('target-c', 'conn-2', 3, T0 + 15);
    // offlineSince = T0 + 10 → need now ≥ T0 + 60_000 + 10.
    const removed = reg.prune(T0 + 60_000 + 100, 60_000);
    expect(removed).toBe(2);
    expect(reg.get('target-a')).toBeUndefined();
    expect(reg.get('target-b')).toBeUndefined();
    expect(reg.get('target-c')).toBeDefined();
  });

  it('prune keeps offline sessions inside the grace window', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 1, T0);
    reg.markOffline('conn-1', T0 + 10);
    expect(reg.prune(T0 + 10 + 59_999, 60_000)).toBe(0);
    expect(reg.size()).toBe(1);
  });

  it('snapshot returns console-facing session info', () => {
    const reg = new SessionRegistry();
    reg.upsert('target-a', 'conn-1', 42, T0);
    expect(reg.snapshot()).toEqual([
      { targetId: 'target-a', tabId: 42, status: 'online', lastSeen: T0 },
    ]);
  });
});
