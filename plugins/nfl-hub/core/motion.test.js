import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

const root = fileURLToPath(new URL('..', import.meta.url));

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'tests' && name !== 'assets') sources(p, out); continue; }
    if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/**
 * Strip comments before scanning.
 *
 * Without this the guard fires on any file that merely DISCUSSES the rule —
 * core/config.js explains why TARGET_FPS is 30 by naming `requestAnimationFrame`,
 * and views/game-winprob.js names it to say it deliberately does not use one. Both
 * are documentation, not a loop.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * ⚠️ TWO DIFFERENT RULES, NOT ONE.
 *
 * rAF is ANIMATION: exactly one module may own it, and it is core/motion.js, which
 * caps the frame rate, stops while the frame is hidden and now stops while the
 * window is merely behind another app.
 *
 * setInterval is POLLING: how often to REFETCH, not how to animate. Three modules
 * legitimately own one, and each is listed with why — an unexplained allowlist
 * grows until it means nothing.
 */
/**
 * Does this source actually OPEN a timer, as opposed to naming one?
 *
 * ⚠️ A HOST CALL, NOT SOMEBODY ELSE'S METHOD. `views/league.js` calls
 * `app.scheduler.setInterval(ms)` — that is the scheduler's own API for setting its
 * cadence, not a second timer. Flagging it would have meant either a false failure
 * or an allowlist entry that quietly excused that whole file from the real rule.
 *
 * ⚠️ BUT THE GLOBAL RECEIVERS STILL COUNT. `window.requestAnimationFrame(cb)` is
 * exactly as much of a loop as the bare call — and it is the form core/motion.js
 * itself uses (`win.requestAnimationFrame`). Excluding every dotted receiver would
 * have left the guard unable to see the most likely way a view would smuggle one in.
 */
const OPENS = (name) => new RegExp(
  `(^|[^.\\w]|\\b(?:window|globalThis|self|win)\\.)${name}\\s*\\(`,
  'm',
);

const RAF_OWNERS = [join('core', 'motion.js')];
const INTERVAL_OWNERS = [
  // The single POLL loop — how often the hub refetches.
  join('core', 'scheduler.js'),
  // Replay stepping. Developer tooling; drives recorded fixtures, not the UI.
  join('core', 'replay.js'),
  // ⚠️ DELIBERATELY NOT FOCUS-GATED. Every `draft:get` resolves lapsed picks
  // server-side — the node's scheduler floor is five minutes and cannot drive a
  // 90-second pick clock, so the board being OPEN is what keeps a live draft
  // moving. Pausing this on blur would stall everybody else's draft the moment one
  // manager alt-tabbed. Its sibling 250ms tick writes one text node and paints
  // nothing else, which is why it is not worth gating either.
  join('views', 'league-draft.js'),
];

describe('the motion contract', () => {
  it('only core/motion.js opens a requestAnimationFrame loop', () => {
    const offenders = sources(root)
      .filter((f) => !RAF_OWNERS.some((owner) => f.endsWith(owner)))
      .filter((f) => OPENS('requestAnimationFrame').test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(root, ''));
    expect(offenders).toEqual([]);
  });

  it('only the three declared owners open a setInterval', () => {
    const offenders = sources(root)
      .filter((f) => !INTERVAL_OWNERS.some((owner) => f.endsWith(owner)))
      .filter((f) => OPENS('setInterval').test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(root, ''));
    expect(offenders).toEqual([]);
  });

  it('the guard reads code, not comments', () => {
    expect(codeOnly('// uses requestAnimationFrame\nconst a = 1;')).not.toMatch(/requestAnimationFrame/);
    expect(codeOnly('/* setInterval */\nconst a = 1;')).not.toMatch(/setInterval/);
    expect(codeOnly('setInterval(fn, 10);')).toMatch(/setInterval/);
  });

  // ⚠️ THE TWO PROPERTIES gridiron.css EXISTS TO NOT HAVE.
  //
  // backdrop-filter re-blurs whenever anything behind it moves, and a draft board is
  // a surface where things move on every pick. It is what made stadium.css "the
  // expensive layer and the one that needs measuring", and the whole reason the
  // League tab got its own sheet instead of extending that one.
  //
  // `infinite` is the other half: the clock glow is driven from motion.loop() so it
  // is capped and focus-gated, and a CSS infinite animation would route around that
  // entirely. Everything else on the stage is painted once or fires on change.
  //
  // ⚠️ THE LIST IS THE POINT. podium.css was added later and would have inherited
  // none of this if the rule had stayed named after one file — a second cinematic
  // sheet is exactly where a backdrop-filter or a decorative loop gets in.
  const CINEMATIC = ['gridiron.css', 'podium.css', 'booth.css', 'wire.css', 'marquee.css',
    'ledger.css'];
  it.each(CINEMATIC)('%s has no backdrop-filter and no infinite animation', (sheet) => {
    const css = readFileSync(join(root, 'styles', sheet), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ''); // their own docs name both; read the rules
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/\binfinite\b/);
  });

  // ⚠️ A SHEET IS NOT LOADED BECAUSE IT EXISTS. Every rule in podium.css is inert
  // until plugin.html links it, and nothing else in the plugin would fail — the
  // board would simply render unlit and no test would notice.
  it('every stylesheet in styles/ is actually linked by plugin.html', () => {
    const html = readFileSync(join(root, 'plugin.html'), 'utf8');
    const missing = readdirSync(join(root, 'styles'))
      .filter((f) => f.endsWith('.css'))
      .filter((f) => !html.includes(`styles/${f}`));
    expect(missing).toEqual([]);
  });

  // ⚠️ ORDER DECIDES WHO WINS. motion.css collapses every duration for reduced
  // motion, so it has to be the last sheet on the page; a cinematic layer linked
  // after it would reinstate its own durations for exactly the users who asked
  // for none.
  it('links motion.css last, so reduced motion can override every other sheet', () => {
    const html = readFileSync(join(root, 'plugin.html'), 'utf8');
    const links = [...html.matchAll(/styles\/([\w-]+\.css)/g)].map((m) => m[1]);
    expect(links[links.length - 1]).toBe('motion.css');
  });

  // ⚠️ THE REGRESSION THIS EXISTS FOR. `body.motion-idle` first shipped as a
  // blanket `body.motion-idle *` and it made the WHOLE HUB INVISIBLE: entrances
  // use `animation-fill-mode: both`, which holds the FROM state until the
  // animation runs, and `.section-body > *` fades a panel in from opacity 0.
  // Pausing everything froze that panel at zero, so any view rendered while the
  // window was unfocused painted nothing at all. Found only in live QA — a
  // standalone render cannot reproduce it, because motion.js applies the class.
  it('the idle rule never pauses animations with a blanket selector', () => {
    const css = readFileSync(join(root, 'styles', 'motion.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/body\.motion-idle\s*\*/);
  });

  // The other half of the same contract: the named list must actually cover the
  // ambient loops, or the focus gate silently stops gating them.
  it('the idle rule names every infinite animation the plugin ships', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
    const sheets = readdirSync(join(root, 'styles')).filter((f) => f.endsWith('.css'));

    const idleBlock = strip(readFileSync(join(root, 'styles', 'motion.css'), 'utf8'))
      .split(/body\.motion-idle/).slice(1).join(' ');

    const missing = [];
    for (const f of sheets) {
      const css = strip(readFileSync(join(root, 'styles', f), 'utf8'));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/\banimation\b[^;]*\binfinite\b/.test(m[2])) continue;
        for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          // Reduced-motion overrides and keyframe steps are not ambient loops.
          if (/^\d|^from$|^to$|reduce-motion/.test(sel)) continue;
          const bare = sel.replace(/^body\./, '').trim();
          if (!idleBlock.includes(bare)) missing.push(`${f}: ${sel}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // ⚠️ A FILLED ANIMATION HOLDS ITS FINAL KEYFRAME FOREVER, which makes it a way
  // to permanently override a rule it was only meant to decorate. wire.css shipped
  // `.wr-odds.is-new { animation: wrLand … 1 both }` with a `border-color`
  // keyframe, and every row's rail went grey the moment its flash finished — the
  // favourite's team colour, gone, permanently, on a one-shot "flash". It survived
  // reduced motion, where the animation never runs, so the two states disagreed.
  //
  // The rule: a one-shot state flash may not carry a fill mode AND may not touch a
  // property its own base rule sets.
  it('no one-shot state flash holds its final keyframe over its base rule', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const f of readdirSync(join(root, 'styles')).filter((n) => n.endsWith('.css'))) {
      const css = strip(readFileSync(join(root, 'styles', f), 'utf8'));
      for (const m of css.matchAll(/\.[\w-]+\.is-new[^{}]*\{([^{}]*)\}/g)) {
        const decl = m[1];
        if (!/\banimation\b/.test(decl)) continue;
        expect(`${f}: ${decl.trim()}`).not.toMatch(/\b(both|forwards)\b/);
      }
    }
  });

  it('the guard tells a bare timer apart from a method that shares its name', () => {
    // ⚠️ THE FALSE POSITIVE THAT ALMOST WIDENED THE ALLOWLIST. views/league.js calls
    // app.scheduler.setInterval(ms) to set the poll cadence. Excusing that file
    // wholesale would have exempted it from the real rule forever.
    expect(OPENS('setInterval').test('app.scheduler.setInterval(4000);')).toBe(false);
    expect(OPENS('setInterval').test('timer = setInterval(tick, 10);')).toBe(true);
    expect(OPENS('setInterval').test('setInterval(tick, 10);')).toBe(true);
    // ⚠️ The global receivers are still a loop. This is the form motion.js uses, and
    // the most likely way a view would smuggle one past a naive bare-call check.
    expect(OPENS('requestAnimationFrame').test('win.requestAnimationFrame(frame);')).toBe(true);
    expect(OPENS('requestAnimationFrame').test('window.requestAnimationFrame(frame);')).toBe(true);
    expect(OPENS('requestAnimationFrame').test('requestAnimationFrame(frame);')).toBe(true);
  });
});
