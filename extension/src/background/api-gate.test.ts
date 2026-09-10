// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_MIN_INTERVAL_MS, installApiGate, nextSlot } from './api-gate.js';

const NOW = 1_700_000_000_000;

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
let listener: Listener | null = null;
let store: Record<string, unknown> = {};
let setFails = false;

function mockChrome(): void {
  listener = null;
  store = {};
  setFails = false;
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { onMessage: { addListener: (fn: Listener) => (listener = fn) } },
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj: Record<string, unknown>) => {
          if (setFails) throw new Error('storage unavailable');
          Object.assign(store, obj);
        },
      },
    },
  };
}

/** Asks the SW for an API slot and resolves with its answer. */
function ask(): Promise<{ ok: boolean; at: number }> {
  return new Promise((resolve) => {
    listener?.({ type: 'tomi-api-slot' }, { tab: { id: 1 } }, (r) => resolve(r as { ok: boolean; at: number }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  mockChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('nextSlot', () => {
  it('grants the first call', () => {
    expect(nextSlot(0, NOW)).toEqual({ ok: true, at: NOW });
  });

  it('denies a second call inside the window', () => {
    expect(nextSlot(NOW, NOW + GLOBAL_MIN_INTERVAL_MS - 1)).toEqual({ ok: false, at: NOW });
  });

  it('grants again once the window has passed', () => {
    expect(nextSlot(NOW, NOW + GLOBAL_MIN_INTERVAL_MS)).toEqual({ ok: true, at: NOW + GLOBAL_MIN_INTERVAL_MS });
  });

  it('treats a corrupt timestamp as "never used"', () => {
    expect(nextSlot(Number.NaN, NOW).ok).toBe(true);
  });
});

describe('installApiGate', () => {
  it('hands out one slot per window across ALL tabs', async () => {
    installApiGate();

    // Three tabs asking at the same moment — exactly what used to happen with
    // a per-content-script clock.
    const [a, b, c] = await Promise.all([ask(), ask(), ask()]);
    expect([a.ok, b.ok, c.ok].filter(Boolean)).toHaveLength(1);

    // ...and the next tab in line waits for the window, not for its own tab.
    expect((await ask()).ok).toBe(false);
    vi.setSystemTime(new Date(NOW + GLOBAL_MIN_INTERVAL_MS));
    expect((await ask()).ok).toBe(true);
  });

  it('persists the clock so an SW restart cannot hand out a free slot', async () => {
    installApiGate();
    expect((await ask()).ok).toBe(true);

    // Same storage, fresh listener — what a woken SW looks like.
    listener = null;
    store = { ...store };
    installApiGate();

    expect((await ask()).ok).toBe(false);
  });

  it('denies the slot when storage cannot be written', async () => {
    // A denied slot costs a slightly rougher JD; a granted one that was never
    // recorded costs another request into a possibly challenged session.
    installApiGate();
    setFails = true;

    expect((await ask()).ok).toBe(false);
  });

  it('ignores unrelated runtime messages', async () => {
    installApiGate();
    expect(listener?.({ type: 'something-else' }, {}, () => undefined)).toBeUndefined();
  });
});
