import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderFighter } from './fighter.js';
import { parseAthlete } from '../core/ufc-athlete.js';
import { parseEvent } from '../core/ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const html = (n) => readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8');

const cf = parseEvent(fx('cf-event-upcoming.json'));
const base = cf.fights[0].red;
const stats = parseAthlete(html('ufc-athlete-gamrot.html'));

describe('renderFighter', () => {
  it('shows the physicals CloudFront already gave us', () => {
    const out = renderFighter({ base, stats: null }, new Map());
    expect(out).toContain('Gamrot');
    expect(out).toContain('Southpaw');
    expect(out).toContain('Poznan');
  });

  it('renders WITHOUT career stats, because the scrape may fail', () => {
    const out = renderFighter({ base, stats: null }, new Map());
    expect(out).not.toContain('Striking accuracy');
    expect(out).toContain('Gamrot');
  });

  it('shows career statistics when the page parsed', () => {
    const out = renderFighter({ base, stats }, new Map());
    expect(out).toContain('52%');           // striking accuracy
    expect(out).toContain('Sig. Str. Landed');
  });

  it('calls them career statistics, and does NOT reuse the tracked-actions wording', () => {
    // ⚠️ The mirror of the guard in views/versus.test.js. A FIGHT may not claim strike
    // statistics, because no source has per-fight strike data. A FIGHTER may, because
    // ufc.com publishes career numbers. Neither label may drift onto the other.
    const out = renderFighter({ base, stats }, new Map()).toLowerCase();
    expect(out).toContain('career');
    expect(out).not.toContain('tracked actions');
  });

  it('attributes the numbers to ufc.com', () => {
    expect(renderFighter({ base, stats }, new Map()).toLowerCase()).toContain('ufc.com');
  });

  it('routes the headshot through the image proxy', () => {
    const athletes = new Map([[base.fighterId, { espnId: '3068125' }]]);
    const out = renderFighter({ base, stats }, athletes);
    expect(out).toContain('/api/v1/plugins/image?url=');
    expect(out).not.toContain('src="https://a.espncdn.com');
  });

  it('shows a loading state rather than an empty panel', () => {
    expect(renderFighter({ base, stats: null }, new Map(), { loading: true }))
      .toContain('spinner');
  });

  it('never throws on nothing', () => {
    expect(() => renderFighter(null, new Map())).not.toThrow();
    expect(renderFighter(null, new Map())).toBe('');
  });
});
