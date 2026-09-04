import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AckTracker, classifyFailure } from './timeout.js';

describe('AckTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires the timeout callback after the ack window', () => {
    const tracker = new AckTracker();
    const onTimeout = vi.fn();
    tracker.arm('r1', 5000, onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(tracker.size()).toBe(0);
  });

  it('cancel prevents the timeout from firing', () => {
    const tracker = new AckTracker();
    const onTimeout = vi.fn();
    tracker.arm('r1', 5000, onTimeout);
    expect(tracker.cancel('r1')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(tracker.cancel('r1')).toBe(false);
  });

  it('re-arming replaces the previous clock', () => {
    const tracker = new AckTracker();
    const first = vi.fn();
    const second = vi.fn();
    tracker.arm('r1', 5000, first);
    tracker.arm('r1', 5000, second);
    expect(tracker.size()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancelAll abandons matching clocks', () => {
    const tracker = new AckTracker();
    const a = vi.fn();
    const b = vi.fn();
    tracker.arm('r1', 5000, a);
    tracker.arm('r2', 5000, b);
    tracker.cancelAll((requestId) => requestId === 'r1');
    vi.advanceTimersByTime(5000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('classifyFailure', () => {
  it('session gone → tab-closed', () => {
    expect(classifyFailure(undefined)).toBe('tab-closed');
  });
  it('session offline → tab-idle', () => {
    expect(classifyFailure({ targetId: 't', status: 'offline', lastSeen: 0 })).toBe('tab-idle');
  });
  it('session online but no ack → selector-failed', () => {
    expect(classifyFailure({ targetId: 't', status: 'online', lastSeen: 0 })).toBe('selector-failed');
  });
});
