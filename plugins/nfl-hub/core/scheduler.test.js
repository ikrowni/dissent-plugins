import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScheduler } from './scheduler.js';

function fakeVisibility(state = 'visible') {
  const listeners = new Set();
  return {
    get visibilityState() { return state; },
    set(next) { state = next; listeners.forEach((fn) => fn()); },
    addEventListener(_evt, fn) { listeners.add(fn); },
    removeEventListener(_evt, fn) { listeners.delete(fn); },
  };
}

describe('createScheduler', () => {
  let doc;
  beforeEach(() => { vi.useFakeTimers(); doc = fakeVisibility(); });

  it('does not run the task before start', () => {
    const task = vi.fn();
    createScheduler({ doc, intervalMs: 1000 }).add(task);
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
  });

  it('runs every registered task once per tick', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const a = vi.fn(); const b = vi.fn();
    s.add(a); s.add(b);
    s.start();
    expect(a).toHaveBeenCalledTimes(1); // immediate first tick
    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('stops ticking while the document is hidden', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start();
    expect(task).toHaveBeenCalledTimes(1);
    doc.set('hidden');
    vi.advanceTimersByTime(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('ticks immediately on becoming visible again, so data is never stale on return', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start();
    doc.set('hidden');
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);
    doc.set('visible');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not start ticking if it was already hidden at start', () => {
    const hidden = fakeVisibility('hidden');
    const s = createScheduler({ doc: hidden, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start();
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
  });

  it('honours a changed interval without losing registrations', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start();
    s.setInterval(100);
    vi.advanceTimersByTime(300);
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('remove unregisters a task', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    const off = s.add(task);
    s.start();
    off();
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('a throwing task does not stop the loop or its siblings', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    s.add(bad); s.add(good);
    s.start();
    vi.advanceTimersByTime(2000);
    expect(good.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stop halts everything and is idempotent', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start(); s.stop(); s.stop();
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('start is idempotent, so it cannot double-arm the timer', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start(); s.start();
    expect(task).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('destroy stops the loop and detaches the visibility listener', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    const task = vi.fn();
    s.add(task); s.start();
    s.destroy();
    doc.set('visible');
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(s.taskCount).toBe(0);
  });

  it('reports whether it is running', () => {
    const s = createScheduler({ doc, intervalMs: 1000 });
    expect(s.isRunning).toBe(false);
    s.start();
    expect(s.isRunning).toBe(true);
    s.stop();
    expect(s.isRunning).toBe(false);
  });
});
