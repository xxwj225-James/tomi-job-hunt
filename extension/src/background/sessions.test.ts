// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the ws client so we can observe what the registry sends to the gateway.
const mocks = vi.hoisted(() => ({
  sendSession: vi.fn(),
  sendAck: vi.fn(),
}));

vi.mock('./ws-client.js', () => ({
  sendSession: mocks.sendSession,
  sendAck: mocks.sendAck,
}));

import {
  installMessageListener,
  installTabListeners,
  listSessionIds,
  loadSessions,
  pruneClosedTabs,
  tabIdFor,
} from './sessions.js';

type MsgListener = (msg: unknown, sender: { tab?: { id?: number } }) => void;
let onMsg: MsgListener | null = null;
let onTabRemoved: ((tabId: number) => void) | null = null;

const storageSet = vi.fn(async () => undefined);
const tabsGet = vi.fn(async () => undefined as unknown);

function mockChrome(): void {
  onMsg = null;
  onTabRemoved = null;
  mocks.sendSession.mockClear();
  mocks.sendAck.mockClear();
  storageSet.mockClear();
  tabsGet.mockClear();
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: { addListener: (fn: MsgListener) => { onMsg = fn; } },
    },
    storage: {
      session: {
        set: storageSet,
        get: async () => ({}),
      },
    },
    tabs: {
      onRemoved: { addListener: (fn: (id: number) => void) => { onTabRemoved = fn; } },
      get: tabsGet,
      query: async () => [],
      sendMessage: async () => undefined,
    },
  };
}

beforeEach(async () => {
  mockChrome();
  await loadSessions(); // clears the in-memory map
  installMessageListener();
  installTabListeners();
});

describe('session upsert/remove routing', () => {
  it('upsert stores sender.tab.id and forwards to the gateway', async () => {
    onMsg?.({ type: 'tomi-session', action: 'upsert', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1));
    expect(mocks.sendSession).toHaveBeenCalledWith('upsert', 'jd:uid1', 5);
    expect(listSessionIds()).toEqual(['jd:uid1']);
    expect(tabIdFor('jd:uid1')).toBe(5);
    expect(storageSet).toHaveBeenCalled();
  });

  it('ignores remove from a tab that does not own the session', async () => {
    onMsg?.({ type: 'tomi-session', action: 'upsert', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1));

    onMsg?.({ type: 'tomi-session', action: 'remove', targetId: 'jd:uid1' }, { tab: { id: 99 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1)); // no extra send
    expect(listSessionIds()).toEqual(['jd:uid1']);
  });

  it('remove by the owning tab drops the session and tells the gateway', async () => {
    onMsg?.({ type: 'tomi-session', action: 'upsert', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1));

    onMsg?.({ type: 'tomi-session', action: 'remove', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(2));
    expect(mocks.sendSession).toHaveBeenLastCalledWith('remove', 'jd:uid1');
    expect(listSessionIds()).toEqual([]);
  });
});

describe('ack forwarding', () => {
  it('relays a content ack to the gateway verbatim', () => {
    onMsg?.({ type: 'tomi-ack', requestId: 'r1', ok: false, error: '未找到聊天输入框' }, { tab: { id: 5 } });
    expect(mocks.sendAck).toHaveBeenCalledWith({ type: 'ack', requestId: 'r1', ok: false, error: '未找到聊天输入框' });
  });

  it('treats a missing ok as success', () => {
    onMsg?.({ type: 'tomi-ack', requestId: 'r2', domSnippet: '已发出' }, { tab: { id: 5 } });
    expect(mocks.sendAck).toHaveBeenCalledWith({ type: 'ack', requestId: 'r2', ok: true, domSnippet: '已发出' });
  });
});

describe('tab lifecycle', () => {
  it('tab close removes sessions it owns', async () => {
    onMsg?.({ type: 'tomi-session', action: 'upsert', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1));

    onTabRemoved?.(5);
    expect(listSessionIds()).toEqual([]);
    expect(mocks.sendSession).toHaveBeenLastCalledWith('remove', 'jd:uid1');
  });

  it('pruneClosedTabs drops sessions whose tab no longer exists', async () => {
    onMsg?.({ type: 'tomi-session', action: 'upsert', targetId: 'jd:uid1' }, { tab: { id: 5 } });
    await vi.waitFor(() => expect(mocks.sendSession).toHaveBeenCalledTimes(1));
    tabsGet.mockRejectedValueOnce(new Error('No tab with id: 5'));

    await pruneClosedTabs();
    expect(listSessionIds()).toEqual([]);
  });
});
