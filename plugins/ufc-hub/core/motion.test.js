import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createMotion } from './motion.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'tests') sources(p, out); continue; }
    if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/**
 * Strip comments before scanning.
 *
 * Without this the guard fires on any file that merely DISCUSSES the rule — core/config.js
 * explains why TARGET_FPS is 30 by naming `requestAnimationFrame`, which is documentation,
 * not a loop.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// Two modules are allowed to own a timer, and only these two:
//   core/motion.js    — the single ANIMATION loop (frame-capped, visibility-gated)
//   core/scheduler.js — the single POLL loop (how often to refetch, not how to animate)
const LOOP_OWNERS = [join('core', 'motion.js'), join('core', 'scheduler.js')];

describe('the motion contract', () => {
  // A 15px animate-ping dot was once ~68% of desktop idle GPU, animated avatars were
  // 44%, and an uncapped rAF in ChatBackground was the idle hog. core/motion.js is the
  // ONLY sanctioned animation loop — it caps the frame rate, stops dead while the frame
  // is hidden, and never starts at all under prefers-reduced-motion.
  it('no module outside the two loop owners starts its own timer', () => {
    const offenders = [];
    for (const f of sources(root)) {
      if (LOOP_OWNERS.some((owner) => f.endsWith(owner))) continue;
      if (/requestAnimationFrame|setInterval/.test(codeOnly(readFileSync(f, 'utf8')))) {
        offenders.push(f.replace(root, ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  // ⚠️ THE REGRESSION THESE EXIST FOR. `body.motion-idle` first shipped as a
  // blanket `body.motion-idle *` and it made the hub INVISIBLE: entrances use
  // `animation-fill-mode: both`, which holds the FROM state (opacity 0) until the
  // animation runs, so anything rendered while the window was unfocused painted
  // nothing at all. Kept in step with plugins/nfl-hub/core/motion.test.js.
  it('the idle rule never pauses animations with a blanket selector', () => {
    const css = readFileSync(join(root, 'styles', 'base.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/body\.motion-idle\s*\*/);
  });

  it('the idle rule names every infinite animation the plugin ships', () => {
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '');
    const dir = join(root, 'styles');
    const idleBlock = strip(readFileSync(join(dir, 'base.css'), 'utf8'))
      .split(/body\.motion-idle/).slice(1).join(' ');

    const missing = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
      const css = strip(readFileSync(join(dir, f), 'utf8'));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/\banimation\b[^;]*\binfinite\b/.test(m[2])) continue;
        for (const sel of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          if (/^\d|^from$|^to$|reduce-motion/.test(sel)) continue;
          if (!idleBlock.includes(sel.replace(/^body\./, '').trim())) missing.push(`${f}: ${sel}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the guard reads code, not comments', () => {
    expect(codeOnly('// uses requestAnimationFrame\nconst a = 1;'))
      .not.toMatch(/requestAnimationFrame/);
    expect(codeOnly('/* setInterval */\nconst a = 1;')).not.toMatch(/setInterval/);
    expect(codeOnly('setInterval(fn, 10);')).toMatch(/setInterval/);
  });

  it('never starts a loop when reduced motion is requested', () => {
    const m = createMotion({
      win: { matchMedia: () => ({ matches: true }) },
      doc: { addEventListener() {}, removeEventListener() {}, hidden: false },
    });
    let ran = false;
    const stop = m.loop(() => { ran = true; });
    expect(ran).toBe(false);
    expect(typeof stop).toBe('function');
  });

  it('exposes a body class so CSS can fall back too', () => {
    const m = createMotion({
      win: { matchMedia: () => ({ matches: true }) },
      doc: { addEventListener() {}, removeEventListener() {}, hidden: false },
    });
    expect(m.bodyClass).toBe('reduce-motion');
  });

  it('has no body class when motion is allowed', () => {
    const m = createMotion({
      win: { matchMedia: () => ({ matches: false }) },
      doc: { addEventListener() {}, removeEventListener() {}, hidden: false },
    });
    expect(m.bodyClass).toBe('');
  });

  // ⚠️ visibilitychange fires when a tab is hidden or a window is MINIMISED. A window
  // merely sitting behind another application still reports visibilityState
  // 'visible', so before this gate the loop kept running with nobody looking — the
  // shape of all three of this project's measured GPU incidents.
  it('stops looping while the window is blurred, even though it is still visible', () => {
    const winListeners = new Map();
    let focused = true;
    const classes = new Set();
    const doc = {
      visibilityState: 'visible',
      addEventListener() {}, removeEventListener() {},
      hasFocus: () => focused,
      body: { classList: { toggle(n, on) { if (on) classes.add(n); else classes.delete(n); } } },
    };
    const win = {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb) => { setTimeout(() => cb(Date.now()), 16); return 1; },
      cancelAnimationFrame() {},
      addEventListener(n, fn) {
        if (!winListeners.has(n)) winListeners.set(n, new Set());
        winListeners.get(n).add(fn);
      },
      removeEventListener(n, fn) { winListeners.get(n)?.delete(fn); },
    };
    vi.useFakeTimers();
    const m = createMotion({ doc, win, fps: 30 });
    const cb = vi.fn();
    m.loop(cb);
    vi.advanceTimersByTime(200);
    const before = cb.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    focused = false;
    winListeners.get('blur').forEach((fn) => fn());
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBe(before);
    expect(classes.has('motion-idle')).toBe(true);
    m.destroy();
    vi.useRealTimers();
  });
});
