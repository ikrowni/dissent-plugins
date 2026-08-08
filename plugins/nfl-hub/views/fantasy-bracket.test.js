import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBracket, bracketRounds } from '../core/sleeper-bracket.js';
import { renderPanel } from './fantasy-bracket.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const rounds = bracketRounds(parseBracket(fx('sleeper-winners-bracket.json')));
const names = {
  3: 'Three', 5: 'Five', 7: 'Seven', 8: 'Eight', 11: 'Eleven', 12: 'Twelve',
};
const state = { bracketRounds: rounds, rosterNames: names, bracketKind: 'winners' };

describe('renderPanel', () => {
  it('renders one column per round', () => {
    const html = renderPanel(state);
    expect((html.match(/class="bk-round"/g) ?? [])).toHaveLength(3);
  });

  it('names both sides of a played match', () => {
    const html = renderPanel(state);
    expect(html).toContain('Seven');
    expect(html).toContain('Three');
  });

  it('marks the winner of a decided match', () => {
    expect(renderPanel(state)).toContain('bk-won');
  });

  it('labels the championship', () => {
    expect(renderPanel(state)).toContain('Championship');
  });

  it('describes an unresolved side by its source match', () => {
    const pending = bracketRounds(parseBracket([
      { m: 1, r: 1, t1: 1, t2: 2 },
      { m: 2, r: 2, t1_from: { w: 1 }, t2_from: { l: 1 } },
    ]));
    const html = renderPanel({ ...state, bracketRounds: pending });
    expect(html).toContain('Winner of M1');
    expect(html).toContain('Loser of M1');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ bracketRounds: [] })).toContain('bracket');
  });
});
