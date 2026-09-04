/**
 * Ack clock + failure classification.
 *
 * The Ack clock starts when a command is actually dispatched to an agent (not
 * when it was enqueued — the buffer may hold it for up to its TTL first). When
 * the clock fires with no ack, the gateway classifies the failure from the
 * session state at that moment.
 */
import type { FailedReason, SessionInfo } from './types.js';

interface Clock {
  timer: ReturnType<typeof setTimeout>;
  deadline: number;
}

export class AckTracker {
  private readonly pending = new Map<string, Clock>();

  /** Arm a 5s clock for a dispatched requestId. Re-arming cancels the old clock. */
  arm(requestId: string, timeoutMs: number, onTimeout: () => void): void {
    this.cancel(requestId);
    // The entry is removed the moment the clock fires, so a fired clock never
    // leaks. Callers (router.failOne) also cancel() defensively.
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      onTimeout();
    }, timeoutMs);
    this.pending.set(requestId, { timer, deadline: Date.now() + timeoutMs });
  }

  cancel(requestId: string): boolean {
    const clock = this.pending.get(requestId);
    if (!clock) return false;
    clearTimeout(clock.timer);
    this.pending.delete(requestId);
    return true;
  }

  /** Abandon every clock matching a predicate (e.g. a console connection left). */
  cancelAll(predicate: (requestId: string) => boolean): void {
    for (const requestId of [...this.pending.keys()]) {
      if (predicate(requestId)) this.cancel(requestId);
    }
  }

  size(): number {
    return this.pending.size;
  }
}

/**
 * Classify a dispatch that produced no ack before the clock expired. Order
 * matters:
 *   1. session vanished            → tab-closed  (the tab was closed)
 *   2. session still present but
 *      offline                    → tab-idle    (connection dropped, no reply)
 *   3. session online, no ack      → selector-failed (dispatch landed, page
 *                                                       didn't comply)
 *
 * (Buffer expiry without a reconnect is a separate path and is always
 * 'tab-offline'.)
 */
export function classifyFailure(current: SessionInfo | undefined): FailedReason {
  if (current === undefined) return 'tab-closed';
  if (current.status === 'offline') return 'tab-idle';
  return 'selector-failed';
}
