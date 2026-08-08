import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAthlete, hasAthleteStats } from './ufc-athlete.js';

const html = (n) =>
  readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8');

const gamrot = parseAthlete(html('ufc-athlete-gamrot.html'));
const lemos = parseAthlete(html('ufc-athlete-lemos.html'));

describe('parseAthlete', () => {
  it('reads the identity off the page', () => {
    expect(gamrot.name).toBe('Mateusz Gamrot');
    expect(gamrot.nickname).toBe('Gamer');
    expect(gamrot.record).toBe('26-4-0');
  });

  it('reads every stat, paired with its own label', () => {
    expect(gamrot.stats['Sig. Str. Landed']).toBe('3.21');
    expect(gamrot.stats['Sig. Str. Absorbed']).toBe('2.81');
    expect(gamrot.stats['Takedown avg']).toBe('5.22');
    expect(gamrot.stats['Submission avg']).toBe('0.19');
    expect(gamrot.stats['Knockdown Avg']).toBe('0.10');
    expect(gamrot.stats['Sig. Str. Landed']).not.toContain('%');
    expect(gamrot.stats['Average fight time']).toBe('11:56');
  });

  it('does NOT drop the two percentage stats', () => {
    // ⚠️ REGRESSION GUARD, and the one real trap on this page. The percent div is
    // NESTED INSIDE the number div —
    //     <div class="__number">60 <div class="__percent">%</div></div>
    // — so a `([^<]*?)\s*</div>` match cannot reach the closing tag and silently
    // drops both defence stats, leaving 6 of 8. The first version of this parser did
    // exactly that and the suite was green.
    // ⚠️ And they are PERCENTAGES. The % lives in that same nested div, so dropping it
    // renders "Sig. Str. Defense 60" — which reads as a count, not 60%.
    expect(gamrot.stats['Sig. Str. Defense']).toBe('60%');
    expect(gamrot.stats['Takedown Defense']).toBe('83%');
    expect(Object.keys(gamrot.stats)).toHaveLength(8);
    expect(Object.keys(lemos.stats)).toHaveLength(8);
  });

  it('reads the accuracy donuts out of their SVG titles', () => {
    expect(gamrot.accuracy.striking).toBe(52);
    expect(gamrot.accuracy.takedown).toBe(9);
    expect(lemos.accuracy.striking).toBe(55);
    expect(lemos.accuracy.takedown).toBe(6);
  });

  it('reads strikes by position and the finish breakdown', () => {
    expect(gamrot.position).toEqual(
      expect.arrayContaining([{ label: 'Standing', value: '375 (75%)' }]),
    );
    expect(gamrot.finishes).toEqual(
      expect.arrayContaining([{ label: 'KO/TKO', value: '8 (31%)' }]),
    );
  });

  it('works on a second fighter, so one page cannot pass as the rule', () => {
    expect(lemos.name).toBe('Amanda Lemos');
    expect(lemos.record).toBe('15-6-1');
    expect(lemos.stats['Sig. Str. Landed']).toBe('2.75');
  });

  it('returns a usable empty shape for a page it cannot read', () => {
    const empty = parseAthlete('<html><body>nope</body></html>');
    expect(empty.name).toBe(null);
    expect(empty.stats).toEqual({});
    expect(empty.accuracy).toEqual({ striking: null, takedown: null });
  });

  it('never throws on nothing', () => {
    expect(() => parseAthlete(null)).not.toThrow();
    expect(() => parseAthlete('')).not.toThrow();
  });
});

describe('hasAthleteStats', () => {
  it('is true for a parsed page and false for an empty one', () => {
    expect(hasAthleteStats(gamrot)).toBe(true);
    expect(hasAthleteStats(parseAthlete('<html></html>'))).toBe(false);
    expect(hasAthleteStats(null)).toBe(false);
  });
});
