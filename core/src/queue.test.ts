import { describe, expect, it } from 'vitest';
import { TaskQueue } from './queue.js';
import { Logger } from './logger.js';

const silentLog = new Logger('error', 'test');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TaskQueue', () => {
  it('runs tasks in FIFO order', async () => {
    const q = new TaskQueue(1, silentLog);
    const order: number[] = [];
    const results = await Promise.all([
      q.run(async () => {
        await sleep(20);
        order.push(1);
        return 'a';
      }),
      q.run(async () => {
        order.push(2);
        return 'b';
      }),
    ]);
    expect(results).toEqual(['a', 'b']);
    expect(order).toEqual([1, 2]);
    expect(q.active).toBe(0);
    expect(q.pending).toBe(0);
  });

  it('respects the concurrency limit', async () => {
    const q = new TaskQueue(2, silentLog);
    let running = 0;
    let peak = 0;
    const track = async (): Promise<void> => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(10);
      running -= 1;
    };
    await Promise.all([q.run(track), q.run(track), q.run(track), q.run(track), q.run(track)]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects when the task throws, without blocking the queue', async () => {
    const q = new TaskQueue(1, silentLog);
    const failing = q.run(async () => {
      throw new Error('boom');
    });
    const ok = q.run(async () => 'fine');
    await expect(failing).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('fine');
  });
});
