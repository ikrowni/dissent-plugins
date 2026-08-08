import { describe, it, expect } from 'vitest';
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
});
