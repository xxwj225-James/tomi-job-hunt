/**
 * Concurrency-limited FIFO task queue.
 *
 * Needed because each claude-code call spawns a Claude Code CLI subprocess;
 * unbounded parallelism would pile up processes and memory. ~40 lines, no deps.
 * Job lifecycle events (queued/started/done/error) are emitted by the HTTP
 * layer, which owns job ids.
 */
import type { Logger } from './logger.js';

export class TaskQueue {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private readonly limit: number,
    private readonly log: Logger,
  ) {}

  /** Number of tasks waiting to start (does not include running tasks). */
  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }

  /**
   * Runs `fn` as soon as a concurrency slot is free. FIFO order is preserved.
   * Resolves with the task's return value; rejects if the task throws.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.running += 1;
        this.log.debug(`queue: task started (${this.running} running, ${this.queue.length} pending)`);
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            this.log.debug(`queue: task finished (${this.running} running, ${this.queue.length} pending)`);
            this.dequeue();
          });
      });
      this.dequeue();
    });
  }

  private dequeue(): void {
    while (this.running < this.limit && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) task();
    }
  }
}
