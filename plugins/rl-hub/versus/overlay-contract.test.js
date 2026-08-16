// Cross-references the two modules that talk to each other only through DOM ids.
//
// WHY THIS EXISTS. rl-hub-versus-overlay.js finds its targets with getElementById and bails
// with `if (!el) return;` when one is missing. rl-hub-versus.js renders those elements. The
// coupling is invisible to both: no import, no type, nothing to grep unless you already
// know to look.
//
// The 2026-08-16 layout rewrite dropped five of them at once. Goal cards, crossbar alerts,
// the pause indicator, the goal timeline and the fastest-goal panel all stopped working
// silently — no error, no failing test, 116 tests still green, and the plugin rendered
// perfectly. It shipped.
//
// So this test does not hardcode a list. It reads the ids the overlay module actually asks
// for and asserts each one is either rendered or explicitly excused below. Add a
// getElementById to the overlay module without rendering it and this fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const overlaySrc = readFileSync(join(here, '..', 'rl-hub-versus-overlay.js'), 'utf8');
const layoutSrc = readFileSync(join(here, '..', 'rl-hub-versus.js'), 'utf8');

/// Ids the overlay module looks up but the layout deliberately does not render, each with
/// the reason. An entry here is a decision on the record, not an oversight.
const DELIBERATELY_ABSENT = {
  'vsb-heatmap-canvas':
    'Ball-hit heatmap. Its data is ball hit LOCATIONS, and the Rocket League Stats API ' +
    'carries no positional telemetry — every hit arrives at {0,0}, so the map would draw ' +
    'a single dot at the centre and read as broken. Restore this the day positions ' +
    'arrive; see the spec §4a and versus/__fixtures__/fixture.test.js.',
};

function idsRequestedBy(src) {
  return [...src.matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g)].map((m) => m[1]);
}

function idsRenderedBy(src) {
  return [...src.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
}

describe('overlay ↔ layout DOM contract', () => {
  const requested = [...new Set(idsRequestedBy(overlaySrc))];
  const rendered = new Set(idsRenderedBy(layoutSrc));

  it('finds the ids the overlay module depends on', () => {
    expect(requested.length).toBeGreaterThan(0);
  });

  it.each(requested)('the layout renders %s, or documents why it does not', (id) => {
    if (Object.prototype.hasOwnProperty.call(DELIBERATELY_ABSENT, id)) {
      expect(DELIBERATELY_ABSENT[id].length).toBeGreaterThan(40);
      return;
    }
    expect(rendered.has(id)).toBe(true);
  });

  it('keeps the excuse list honest — no entry for an id nothing asks for', () => {
    for (const id of Object.keys(DELIBERATELY_ABSENT)) {
      expect(requested).toContain(id);
    }
  });

  it('renders the flash overlay host, which carries goals and crossbars', () => {
    expect(rendered.has('vsb-flash-overlay')).toBe(true);
  });
});
