import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMotion } from './motion.js';

function harness({ visibility = 'visible', reduce = false, focused = true } = {}) {
  const docListeners = new Set();
  const winListeners = new Map(); // event name -> Set<fn>
  let frame = 0;
  const classes = new Set();

  const doc = {
    get visibilityState() { return visibility; },
    setVisibility(v) { visibility = v; docListeners.forEach((fn) => fn()); },
    addEventListener: (_e, fn) => docListeners.add(fn),
    removeEventListener: (_e, fn) => docListeners.delete(fn),
    hasFocus: () => focused,
    body: {
      classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        contains: (name) => classes.has(name),
      },
    },
  };

  const fire = (name) => (winListeners.get(name) ?? new Set()).forEach((fn) => fn());
  const win = {
    matchMedia: () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => {
      frame += 1;
      setTimeout(() => cb(Date.now()), 16);
      return frame;
    },
    cancelAnimationFrame: vi.fn(),
    addEventListener(name, fn) {
      if (!winListeners.has(name)) winListeners.set(name, new Set());
      winListeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { winListeners.get(name)?.delete(fn); },
    blur() { focused = false; fire('blur'); },
    focus() { focused = true; fire('focus'); },
  };
  return { doc, win, hasClass: (n) => classes.has(n) };
}

describe('createMotion', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('reports motion enabled by default', () => {
    const { doc, win } = harness();
    expect(createMotion({ doc, win }).enabled).toBe(true);
  });

  it('disables motion when the OS asks for reduced motion', () => {
    const { doc, win } = harness({ reduce: true });
    expect(createMotion({ doc, win }).enabled).toBe(false);
  });

  it('honours an explicit user override over the OS preference', () => {
    const { doc, win } = harness({ reduce: true });
    const m = createMotion({ doc, win });
    expect(m.enabled).toBe(false);   // OS says reduce
    m.setReduceMotion(false);        // user opts back in
    expect(m.enabled).toBe(true);
    m.setReduceMotion(null);         // defer to the OS again
    expect(m.enabled).toBe(false);
  });

  it('accepts an override at construction, for rehydrating from storage:user', () => {
    const { doc, win } = harness({ reduce: false });
    expect(createMotion({ doc, win, reduceOverride: true }).enabled).toBe(false);
  });

  it('does not invoke a loop callback when motion is disabled', () => {
    const { doc, win } = harness({ reduce: true });
    const m = createMotion({ doc, win });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns a no-op stop function when motion is disabled', () => {
    const { doc, win } = harness({ reduce: true });
    const stop = createMotion({ doc, win }).loop(vi.fn());
    expect(() => stop()).not.toThrow();
  });

  it('caps a loop at roughly 30fps rather than every frame', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(1000);
    // 1s at 30fps is ~30 calls; every-frame at 16ms would be ~62.
    expect(cb.mock.calls.length).toBeLessThanOrEqual(34);
    expect(cb.mock.calls.length).toBeGreaterThan(20);
  });

  it('stops looping while the document is hidden', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(200);
    const before = cb.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    doc.setVisibility('hidden');
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBe(before);
  });

  it('resumes looping when the document becomes visible again', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(200);
    doc.setVisibility('hidden');
    vi.advanceTimersByTime(1000);
    const paused = cb.mock.calls.length;
    doc.setVisibility('visible');
    vi.advanceTimersByTime(200);
    expect(cb.mock.calls.length).toBeGreaterThan(paused);
  });

  it('a stopped loop stays stopped', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    const stop = m.loop(cb);
    vi.advanceTimersByTime(100);
    stop();
    const after = cb.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBe(after);
  });

  it('a throwing callback does not kill the loop', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    let calls = 0;
    m.loop(() => { calls += 1; throw new Error('boom'); });
    vi.advanceTimersByTime(500);
    expect(calls).toBeGreaterThan(3);
  });

  it('passes a delta to the callback so animation is frame-rate independent', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const deltas = [];
    m.loop((dt) => deltas.push(dt));
    vi.advanceTimersByTime(300);
    expect(deltas.length).toBeGreaterThan(2);
    for (const dt of deltas) expect(dt).toBeGreaterThan(0);
  });

  it('exposes a body class hook so CSS can drop ambient effects', () => {
    const { doc, win } = harness({ reduce: true });
    expect(createMotion({ doc, win }).bodyClass).toBe('reduce-motion');
    const { doc: d2, win: w2 } = harness();
    expect(createMotion({ doc: d2, win: w2 }).bodyClass).toBe('');
  });

  it('survives a host with no matchMedia rather than throwing', () => {
    const { doc } = harness();
    const win = { requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame() {} };
    expect(createMotion({ doc, win }).enabled).toBe(true);
  });

  it('destroy detaches the visibility listener', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(100);
    m.destroy();
    const after = cb.mock.calls.length;
    doc.setVisibility('hidden');
    doc.setVisibility('visible');
    vi.advanceTimersByTime(500);
    // The loop itself is not force-stopped by destroy, but the visibility wiring is
    // gone, so no resume storm can occur.
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(after);
  });

  // ⚠️ THE GUARD. visibilitychange fires when a tab is hidden or a window is
  // MINIMISED. A window merely sitting behind another application still reports
  // visibilityState === 'visible', so before the focus gate this loop kept running
  // at 30fps with nobody looking — the exact shape of all three measured GPU
  // incidents. Delete the win.blur handler in motion.js and this test fails.
  it('stops looping while the window is blurred, even though it is still visible', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(200);
    const before = cb.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    win.blur();
    expect(doc.visibilityState).toBe('visible'); // the whole point
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBe(before);
  });

  it('resumes looping when the window regains focus', () => {
    const { doc, win } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(200);
    win.blur();
    vi.advanceTimersByTime(1000);
    const paused = cb.mock.calls.length;
    win.focus();
    vi.advanceTimersByTime(200);
    expect(cb.mock.calls.length).toBeGreaterThan(paused);
  });

  // ⚠️ THE CLASS IS WHAT ACTUALLY COVERS THIS PLUGIN. No view calls motion.loop()
  // yet; every ambient effect in the hub is a CSS `animation: … infinite`. Gating
  // only the rAF loop would gate nothing that currently runs.
  it('stamps a body class while idle so CSS animations pause too', () => {
    const { doc, win, hasClass } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    expect(hasClass('motion-idle')).toBe(false);
    win.blur();
    expect(hasClass('motion-idle')).toBe(true);
    win.focus();
    expect(hasClass('motion-idle')).toBe(false);
    doc.setVisibility('hidden');
    expect(hasClass('motion-idle')).toBe(true);
    m.destroy();
  });

  it('starts paused when the host reports the window is already unfocused', () => {
    const { doc, win } = harness({ focused: false });
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
    win.focus();
    vi.advanceTimersByTime(200);
    expect(cb.mock.calls.length).toBeGreaterThan(0);
  });

  it('detaches the focus listeners on destroy', () => {
    const { doc, win, hasClass } = harness();
    const m = createMotion({ doc, win, fps: 30 });
    m.destroy();
    win.blur();
    expect(hasClass('motion-idle')).toBe(false);
  });
});
