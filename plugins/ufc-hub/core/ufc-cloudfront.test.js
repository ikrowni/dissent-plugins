import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent, cardSegments, segmentLabel } from './ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const upcoming = parseEvent(fx('cf-event-upcoming.json'));
const final = parseEvent(fx('cf-event-final.json'));

describe('parseEvent', () => {
  it('reads the event header', () => {
    expect(upcoming).toMatchObject({
      eventId: 1324,
      name: 'UFC Fight Night: Gamrot vs. Salkilld',
      status: 'Upcoming',
      state: 'pre',
    });
    expect(upcoming.startTime).toBe('2026-08-08T21:00Z');
  });

  it('maps a Final status to the post state', () => {
    expect(final.status).toBe('Final');
    expect(final.state).toBe('post');
  });

  it('parses every fight on the card', () => {
    expect(upcoming.fights).toHaveLength(12);
    expect(final.fights).toHaveLength(12);
  });

  it('reads both fighters with their records', () => {
    const f = upcoming.fights[0];
    expect(f.red.name).toBe('Mateusz Gamrot');
    expect(f.blue.name).toBe('Quillan Salkilld');
    expect(f.red.record).toEqual({ wins: 26, losses: 4, draws: 0, noContests: 1 });
  });

  it('reads the physical tale-of-the-tape fields', () => {
    const r = final.fights[0].red;
    expect(r.height).toBe(73);
    expect(r.reach).toBe(76);
    expect(r.stance).toBe('Switch');
    expect(r.weighIn).toBe(185.5);
    expect(r.fightingOutOf).toMatchObject({ City: 'Pretoria', Country: 'South Africa' });
  });

  it('reads the card segment and its broadcaster as the payload spells them', () => {
    // MEASURED: the payload uses 'Main' and 'Prelims1', not 'Main Card'/'Prelims'.
    const f = upcoming.fights[0];
    expect(f.segment).toBe('Main');
    expect(f.broadcaster).toBe('Paramount+');
    expect(new Set(upcoming.fights.map((x) => x.segment))).toEqual(new Set(['Main', 'Prelims1']));
  });

  it('reads the referee and weight class', () => {
    const f = upcoming.fights[0];
    expect(f.referee).toBe('Jason Herzog');
    expect(f.weightClass).toBe('Lightweight');
  });

  it('parses a completed result with method, round and time', () => {
    const f = final.fights[0];
    expect(f.result).toMatchObject({
      method: 'Decision - Unanimous', endingRound: 5, endingTime: '5:00',
      fightOfTheNight: true,
    });
  });

  it('parses the judge scorecards, naming each judge', () => {
    const scores = final.fights[0].result.scores;
    expect(scores.length).toBeGreaterThanOrEqual(3);
    expect(scores[0]).toMatchObject({ judge: "Sal D'amato" });
    expect(scores[0].fighters[0]).toMatchObject({ fighterId: 3599, score: 50 });
  });

  it('reads each fighter outcome on a completed fight', () => {
    const f = final.fights[0];
    expect([f.red.outcome, f.blue.outcome].sort()).toEqual(['Loss', 'Win']);
  });

  it('carries the live fields through', () => {
    expect(upcoming).toHaveProperty('liveFightId');
    expect(upcoming).toHaveProperty('liveRound');
    expect(upcoming).toHaveProperty('liveRoundElapsed');
  });

  it('tolerates empty Accolades without inventing a shape', () => {
    // Measured as [] on the whole fixture card — present but never populated.
    expect(final.fights[0].accolades).toEqual([]);
  });

  it('never throws on a null or malformed payload', () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent({})).toBeNull();
    expect(parseEvent({ LiveEventDetail: {} }).fights).toEqual([]);
  });
});

describe('segmentLabel', () => {
  it('translates the payload vocabulary to what a viewer expects', () => {
    expect(segmentLabel('Main')).toBe('Main Card');
    expect(segmentLabel('Prelims1')).toBe('Prelims');
    expect(segmentLabel('Prelims2')).toBe('Early Prelims');
  });

  it('passes an unknown segment through rather than blanking it', () => {
    expect(segmentLabel('Something New')).toBe('Something New');
  });
});

describe('cardSegments', () => {
  it('groups fights by segment, MAIN CARD FIRST', () => {
    const segs = cardSegments(upcoming.fights);
    // The regression this pins: keying the rank map on 'Main Card' sent the real value
    // 'Main' to the fallback rank and rendered the main card BELOW the prelims.
    expect(segs.map((s) => s.segment)).toEqual(['Main', 'Prelims1']);
    expect(segs.map((s) => s.label)).toEqual(['Main Card', 'Prelims']);
    const total = segs.reduce((n, s) => n + s.fights.length, 0);
    expect(total).toBe(12);
  });

  it('orders fights within a segment by FightOrder ascending, main event first', () => {
    const segs = cardSegments(upcoming.fights);
    const orders = segs[0].fights.map((f) => f.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('puts the main card first even when the payload lists prelims first', () => {
    // THIS is the real guard on SEGMENT_RANK. The fixture happens to list 'Main' fights
    // first, so a rank map keyed on the WRONG strings ('Main Card'/'Prelims') still
    // produces the right order against it — both keys miss, both fall to the `?? 9`
    // fallback, and a stable sort preserves payload order. Reversing the input is what
    // separates "correct by accident" from "correct by construction".
    const segs = cardSegments([
      { segment: 'Prelims1', order: 7 }, { segment: 'Prelims1', order: 8 },
      { segment: 'Main', order: 1 }, { segment: 'Main', order: 2 },
    ]);
    expect(segs.map((s) => s.segment)).toEqual(['Main', 'Prelims1']);
  });

  it('returns [] for no fights', () => {
    expect(cardSegments([])).toEqual([]);
  });
});
