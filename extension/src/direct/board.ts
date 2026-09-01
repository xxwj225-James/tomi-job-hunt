/**
 * 投递追踪 board — chrome.storage.local CRUD (works in direct mode, no Core
 * dependency). Core's board.md stays independent (its format is add/list only);
 * mirroring it is out of scope. Status columns: greeted → applied → interview
 * → offer → rejected.
 */

export const BOARD_KEY = 'tomihunt-board';

export const BOARD_STATUSES = ['greeted', 'applied', 'interview', 'offer', 'rejected'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  greeted: '已打招呼',
  applied: '已投简历',
  interview: '面试中',
  offer: '已Offer',
  rejected: '已拒绝',
};

export interface BoardEntry {
  id: string;
  /** ISO created */
  ts: string;
  /** ISO, bumped on every move/update */
  updatedAt: string;
  status: BoardStatus;
  company: string;
  title: string;
  url: string;
  note?: string;
  /** which pitch actually got sent (which one worked) */
  pitch?: string;
  source: 'manual' | 'pitch-sent';
}

export async function loadBoard(): Promise<BoardEntry[]> {
  try {
    const data = await chrome.storage.local.get(BOARD_KEY);
    const arr = data[BOARD_KEY];
    return Array.isArray(arr) ? (arr as BoardEntry[]) : [];
  } catch {
    return [];
  }
}

export async function addBoardEntry(
  input: Omit<BoardEntry, 'id' | 'ts' | 'updatedAt'>,
): Promise<BoardEntry> {
  const entry: BoardEntry = {
    ...input,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const all = await loadBoard();
  all.push(entry);
  await chrome.storage.local.set({ [BOARD_KEY]: all });
  return entry;
}

export async function updateBoardEntry(
  id: string,
  patch: Partial<Omit<BoardEntry, 'id' | 'ts'>>,
): Promise<BoardEntry | null> {
  const all = await loadBoard();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BOARD_KEY]: all });
  return all[i];
}

export async function moveBoardEntry(id: string, status: BoardStatus): Promise<BoardEntry | null> {
  return updateBoardEntry(id, { status });
}

export async function deleteBoardEntry(id: string): Promise<void> {
  const all = await loadBoard();
  await chrome.storage.local.set({ [BOARD_KEY]: all.filter((e) => e.id !== id) });
}
