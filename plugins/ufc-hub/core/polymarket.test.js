import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cardUrl, cardWindow, classify, parseFightMarket, joinMarkets, pct, american,
} from './polymarket.js';
import { parseEvent } from './ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const card = fx('polymarket-card-20260808.json');
const cf = parseEvent(fx('cf-event-upcoming.json'));

describe('cardWindow / cardUrl', () => {
  it('spans the card day, because endDate is the fight day at local midnight', () => {
    const w = cardWindow('2026-08-08T21:00Z');
    expect(w.from < '2026-08-08T21:00').toBe(true);
    expect(w.to > '2026-08-09T03:59').toBe(true);
  });

  it('bounds the query by DATE, not by limit', () => {
    // ⚠️ REGRESSION GUARD. `limit` does not bound this payload — each event embeds up
    // to 40 markets, so limit=40 measured 2,540,381 B, over the 1 MB fetch cap. Only
    // the date window keeps it small (462,681 B measured for a full card).
    const u = cardUrl('2026-08-08T21:00Z');
    expect(u).toContain('end_date_min=');
    expect(u).toContain('end_date_max=');
    expect(u).toContain('closed=false');
  });

  it('is null for an unparseable date rather than building a bad url', () => {
    expect(cardWindow('nonsense')).toBe(null);
    expect(cardUrl('nonsense')).toBe(null);
  });
});

describe('classify', () => {
  const title = 'UFC Fight Night: Mateusz Gamrot vs. Quillan Salkilld (Lightweight, Main Card)';
  it('reads the moneyline off the market whose question IS the title', () => {
    expect(classify(title, title).kind).toBe('moneyline');
  });
  it('recognises the derivative markets', () => {
    expect(classify('Fight to Go the Distance?', title).kind).toBe('distance');
    expect(classify('Will the fight be won by KO or TKO?', title).kind).toBe('ko');
    expect(classify('Will the fight be won by submission?', title).kind).toBe('sub');
    expect(classify('O/U 2.5 Rounds', title)).toEqual({ kind: 'rounds', line: 2.5 });
  });
  it('does not mistake a per-fighter KO market for the fight-wide one', () => {
    const c = classify('Will Mateusz Gamrot win by KO or TKO?', title);
    expect(c.kind).toBe('fighterKo');
  });
  it('drops anything it cannot place', () => {
    expect(classify('Who will Merab Dvalishivili fight next?', title).kind).toBe(null);
  });
});

describe('parseFightMarket', () => {
  const gamrot = card.find((e) => e.slug === 'ufc-mat10-qui2-2026-08-08');

  it('reads both fighters and their implied probabilities', () => {
    const m = parseFightMarket(gamrot);
    expect(m.names).toEqual(['Mateusz Gamrot', 'Quillan Salkilld']);
    expect(m.prob['Mateusz Gamrot']).toBeCloseTo(0.445, 3);
    expect(m.prob['Quillan Salkilld']).toBeCloseTo(0.555, 3);
  });

  it('reads the method and round markets', () => {
    const m = parseFightMarket(gamrot);
    expect(m.distance).toBeCloseTo(0.41, 2);
    expect(m.ko).toBeCloseTo(0.32, 2);
    expect(m.sub).toBeCloseTo(0.265, 3);
    expect(m.rounds.map((r) => r.line)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
  });

  it('returns null when there is no moneyline to anchor on', () => {
    expect(parseFightMarket({ title: 'x', markets: [] })).toBe(null);
    expect(parseFightMarket(null)).toBe(null);
  });
});

describe('joinMarkets', () => {
  const joined = joinMarkets(cf.fights, card);

  it('attaches odds to the fights that HAVE a market, and no others', () => {
    // ⚠️ POLYMARKET DOES NOT PRICE EVERY FIGHT. The 2026-08-08 window returns 12
    // events, but one is a phantom bout (see below) and Johns vs Vazquez has no
    // market at all — so 11 of the 12 real fights are covered. Any view reading
    // these must treat "no odds" as normal, not as an error or a zero.
    expect(cf.fights).toHaveLength(12);
    expect(joined.size).toBe(11);
  });

  it('leaves an unpriced fight absent rather than inventing a zero', () => {
    const johns = cf.fights.find((f) =>
      [f.red, f.blue].some((x) => x.lastName === 'Johns'));
    expect(joined.has(johns.fightId)).toBe(false);
    expect(joined.get(johns.fightId)).toBeUndefined();
  });

  it('maps the probability onto the right fighter id', () => {
    const main = cf.fights.find((f) => f.order === 1);
    const m = joined.get(main.fightId);
    expect(m.byFighter[main.red.fighterId]).toBeCloseTo(0.445, 3);
    expect(m.byFighter[main.blue.fighterId]).toBeCloseTo(0.555, 3);
  });

  it('IGNORES a market for a bout that is not on the card', () => {
    // ⚠️ The live window returns "Henrique da Silva Lopes vs. Louie Sutherland",
    // which is not on this card — while Sutherland IS, against José Montanha.
    // Matching on one name would hang those odds on the wrong fight.
    expect(card.some((e) => /da Silva Lopes vs\. Louie Sutherland/.test(e.title))).toBe(true);
    const sutherland = cf.fights.find((f) =>
      [f.red, f.blue].some((x) => x.lastName === 'Sutherland'));
    const m = joined.get(sutherland.fightId);
    expect(m.title).toContain('Montanha');
    expect(m.title).not.toContain('da Silva');
  });

  it('matches across a diacritic difference', () => {
    const montanha = cf.fights.find((f) =>
      [f.red, f.blue].some((x) => x.lastName === 'Montanha'));
    expect(joined.get(montanha.fightId)).toBeTruthy();
  });

  it('never throws on empty input', () => {
    expect(joinMarkets([], []).size).toBe(0);
    expect(joinMarkets(null, null).size).toBe(0);
  });
});

describe('pct / american', () => {
  it('renders a probability as a percentage', () => {
    expect(pct(0.445)).toBe(45);
    expect(pct(null)).toBe(null);
  });

  it('converts a probability to the American odds a viewer recognises', () => {
    expect(american(0.445)).toBe('+125');
    expect(american(0.555)).toBe('-125');
    expect(american(0.5)).toBe('-100');
  });

  it('refuses impossible probabilities rather than printing Infinity', () => {
    expect(american(0)).toBe(null);
    expect(american(1)).toBe(null);
    expect(american(null)).toBe(null);
  });
});
