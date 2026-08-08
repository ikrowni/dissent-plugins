import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cardUrl, cardWindow, classify, parseFightMarket, joinMarkets, pct, american, marketUrl,
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
    // ⚠️ Assert the SHAPE, never the price. These are live market numbers — Gamrot was
    // 0.445 in the morning and 0.435 by evening — so pinning a value means the test
    // breaks every time the fixture is refreshed, which trains people to refresh the
    // expectation rather than read the failure.
    const m = parseFightMarket(gamrot);
    expect(m.names).toEqual(['Mateusz Gamrot', 'Quillan Salkilld']);
    const a = m.prob['Mateusz Gamrot'];
    const b = m.prob['Quillan Salkilld'];
    for (const p of [a, b]) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    // Two complementary outcomes: the book prices them to about 1.
    expect(a + b).toBeGreaterThan(0.9);
    expect(a + b).toBeLessThan(1.1);
  });

  it('reads the method and round markets', () => {
    const m = parseFightMarket(gamrot);
    for (const p of [m.distance, m.ko, m.sub]) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    expect(m.rounds.map((r) => r.line)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
    expect(m.rounds.every((r) => 'volume' in r)).toBe(true);
  });

  it('the round markets are INCOHERENT, which is why no view draws them', () => {
    // ⚠️ NOT A BUG IN THE PARSER — a fact about the data, pinned so nobody "fixes" the
    // view by rendering them. P(fight passes round 4) cannot exceed P(passes round 1),
    // yet these books price exactly that, because they are nearly empty.
    const m = parseFightMarket(gamrot);
    const overs = m.rounds.map((r) => r.over);
    const monotonic = overs.every((v, i) => i === 0 || v <= overs[i - 1]);
    expect(monotonic).toBe(false);
    expect(Math.min(...m.rounds.map((r) => r.volume ?? 0))).toBeLessThan(100);
  });

  it('parses the CLOB token ids an order needs, aligned with the names', () => {
    // ⚠️ Without these, buildOrderParams throws "no token id" and the bet path can
    // never place an order. The first version of this parser dropped them silently.
    const m = parseFightMarket(gamrot);
    expect(m.clobTokenIds).toHaveLength(2);
    expect(m.clobTokenIds.every((t) => /^\d{6,}$/.test(t))).toBe(true);
    expect(m.clobTokenIds).toHaveLength(m.names.length);
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
    // Identity, not value: each fighter gets the probability of the outcome NAMED for
    // them. That is what a mis-map would break, and it survives the market moving.
    expect(m.byFighter[main.red.fighterId]).toBe(m.prob[m.names[0]]);
    expect(m.byFighter[main.blue.fighterId]).toBe(m.prob[m.names[1]]);
    expect(m.names[0]).toContain(main.red.lastName);
    expect(m.names[1]).toContain(main.blue.lastName);
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

describe('marketUrl', () => {
  it('builds the market page url from the slug', () => {
    expect(marketUrl('ufc-mat10-qui2-2026-08-08'))
      .toBe('https://polymarket.com/event/ufc-mat10-qui2-2026-08-08');
  });

  it('carries NO referral or affiliate parameter', () => {
    // ⚠️ COMPLIANCE GUARD, not a style rule. The NFA treats referral of customers to an
    // FCM "when compensated on a per-trade basis or by referral fee" as
    // introducing-broker activity requiring registration. An uncompensated link is a
    // materially different thing. Adding a ref/utm/affiliate param here changes this
    // plugin's regulatory posture — if that is ever wanted, it is a decision to take
    // deliberately and with advice, not a tweak to slip past a test.
    const u = marketUrl('ufc-mat10-qui2-2026-08-08');
    expect(u).not.toMatch(/[?&](ref|referral|affiliate|aff|utm_|via|r)=/i);
    expect(u.split('?')).toHaveLength(1);
  });

  it('is null without a slug rather than linking to the homepage', () => {
    expect(marketUrl(null)).toBe(null);
    expect(marketUrl('')).toBe(null);
  });
});
