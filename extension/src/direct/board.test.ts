import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBoardEntry,
  BOARD_STATUS_LABELS,
  BOARD_STATUSES,
  deleteBoardEntry,
  loadBoard,
  moveBoardEntry,
  updateBoardEntry,
} from './board.js';

const store: Record<string, unknown> = {};

function mockChromeStorage(): void {
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => Object.assign(store, obj),
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mockChromeStorage();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('board CRUD', () => {
  it('round-trips add → load', async () => {
    const entry = await addBoardEntry({
      status: 'greeted',
      company: '某某科技',
      title: '后端工程师',
      url: 'https://www.zhipin.com/job/1.html',
      source: 'manual',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.ts).toBeTruthy();

    const all = await loadBoard();
    expect(all).toHaveLength(1);
    expect(all[0]!.company).toBe('某某科技');
    expect(all[0]!.status).toBe('greeted');
  });

  it('moveBoardEntry changes status and bumps updatedAt', async () => {
    const entry = await addBoardEntry({
      status: 'greeted',
      company: 'A',
      title: 'T',
      url: '',
      source: 'manual',
    });
    await new Promise((r) => setTimeout(r, 5));
    const moved = await moveBoardEntry(entry.id, 'interview');
    expect(moved?.status).toBe('interview');
    expect(moved?.updatedAt >= entry.updatedAt).toBe(true);
  });

  it('updateBoardEntry patches note/pitch', async () => {
    const entry = await addBoardEntry({
      status: 'applied',
      company: 'A',
      title: 'T',
      url: '',
      source: 'manual',
    });
    const updated = await updateBoardEntry(entry.id, { note: '已约面', pitch: '你好' });
    expect(updated?.note).toBe('已约面');
    expect(updated?.pitch).toBe('你好');
  });

  it('updateBoardEntry returns null for a missing id', async () => {
    expect(await updateBoardEntry('nope', { note: 'x' })).toBeNull();
    expect(await moveBoardEntry('nope', 'offer')).toBeNull();
  });

  it('deleteBoardEntry removes only the target; missing id is a no-op', async () => {
    const a = await addBoardEntry({ status: 'greeted', company: 'A', title: 'T', url: '', source: 'manual' });
    await addBoardEntry({ status: 'applied', company: 'B', title: 'U', url: '', source: 'manual' });
    await deleteBoardEntry(a.id);
    const all = await loadBoard();
    expect(all).toHaveLength(1);
    expect(all[0]!.company).toBe('B');

    await deleteBoardEntry('nope'); // must not throw
    expect(await loadBoard()).toHaveLength(1);
  });

  it('BOARD_STATUS_LABELS covers every status', () => {
    for (const s of BOARD_STATUSES) {
      expect(BOARD_STATUS_LABELS[s]).toBeTruthy();
    }
    expect(Object.keys(BOARD_STATUS_LABELS)).toHaveLength(BOARD_STATUSES.length);
  });
});
