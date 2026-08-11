import { describe, it, expect } from 'vitest';
import {
  DROP_DESTINATION, FA_HOLD_MS, waiversEnabled, dropDestination, wireClearsAt,
  placeOnWire, removeFromWire, onWaivers, wirePlayers, clearExpired,
  recordAcquisition, forgetAcquisition,
} from './waiver-wire.js';

const DAY = 24 * 60 * 60 * 1000;
const WAIVER_LEAGUE = { waiverClearDays: 2 };
const NO_WAIVERS = { waiverClearDays: 0 };
const NOW = 1_000_000_000_000;

describe('waiversEnabled', () => {
  it('is true when the league clears waivers over days', () => {
    expect(waiversEnabled(WAIVER_LEAGUE)).toBe(true);
  });

  it('is false at zero days, and empty-safe', () => {
    expect(waiversEnabled(NO_WAIVERS)).toBe(false);
    expect(waiversEnabled(null)).toBe(false);
    expect(waiversEnabled({ waiverClearDays: 'x' })).toBe(false);
  });
});

describe('dropDestination', () => {
  it('sends a dropped player to WAIVERS by default', () => {
    expect(dropDestination({ playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  // ⚠️ A league with no waiver period has nothing to hold a player IN.
  it('sends them to free agency when the league runs no waivers', () => {
    expect(dropDestination({ playerId: 'p1', now: NOW, settings: NO_WAIVERS }))
      .toBe(DROP_DESTINATION.FREE_AGENCY);
  });

  // ⚠️ THE 24-HOUR RULE. A free-agent pickup dropped inside a day goes straight
  // back to free agency — the anti-abuse rule that stops a manager parking
  // players on waivers to deny the rest of the league.
  it('sends a same-day free-agent pickup STRAIGHT BACK to free agency', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - 1000, via: 'free_agency' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.FREE_AGENCY);
  });

  it('sends a free-agent pickup held OVER a day to waivers', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - FA_HOLD_MS - 1, via: 'free_agency' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  it('treats exactly 24 hours as held long enough', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - FA_HOLD_MS, via: 'free_agency' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  // ⚠️ THE RULE IS ABOUT HOW HE WAS ACQUIRED, not just how recently. Reading it
  // as "recently acquired" would let a team drop a just-traded star straight
  // past the wire.
  it('does NOT exempt a just-drafted player', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - 1000, via: 'draft' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  it('does NOT exempt a just-traded player', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - 1000, via: 'trade' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  it('does NOT exempt a just-claimed player', () => {
    const acquired = recordAcquisition({}, 'p1', { at: NOW - 1000, via: 'waivers' });
    expect(dropDestination({ acquired, playerId: 'p1', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });

  it('sends an unknown acquisition to waivers rather than guessing', () => {
    expect(dropDestination({ acquired: {}, playerId: 'ghost', now: NOW, settings: WAIVER_LEAGUE }))
      .toBe(DROP_DESTINATION.WAIVERS);
  });
});

describe('wireClearsAt', () => {
  it('adds the league clear period', () => {
    expect(wireClearsAt(NOW, WAIVER_LEAGUE)).toBe(NOW + 2 * DAY);
  });

  it('is now when the league has no waiver period', () => {
    expect(wireClearsAt(NOW, NO_WAIVERS)).toBe(NOW);
  });
});

describe('the wire', () => {
  const wire = () => placeOnWire({}, 'p1', { clearsAt: NOW + DAY, droppedBy: 't1', droppedAt: NOW });

  it('holds a dropped player until he clears', () => {
    expect(onWaivers(wire(), 'p1', NOW)).toBe(true);
  });

  // ⚠️ An expired entry is NOT on waivers even before the sweep runs. The sweep
  // is a scheduled tick and may be late; a free agent must be addable the moment
  // he actually becomes one.
  it('does not hold him past his clear time, even before the sweep', () => {
    expect(onWaivers(wire(), 'p1', NOW + DAY + 1)).toBe(false);
  });

  it('says nothing about a player who was never dropped', () => {
    expect(onWaivers(wire(), 'p2', NOW)).toBe(false);
    expect(onWaivers({}, 'p1', NOW)).toBe(false);
  });

  it('removes a claimed player', () => {
    expect(onWaivers(removeFromWire(wire(), 'p1'), 'p1', NOW)).toBe(false);
  });

  // ⚠️ Re-dropping resets the clock; carrying the old clearsAt would let him
  // clear early through no decision of the league's.
  it('resets the clock when a player is dropped again', () => {
    const w = placeOnWire(wire(), 'p1', { clearsAt: NOW + 5 * DAY, droppedBy: 't2', droppedAt: NOW });
    expect(w.p1.clearsAt).toBe(NOW + 5 * DAY);
    expect(w.p1.droppedBy).toBe('t2');
  });

  it('does not mutate the wire it was given', () => {
    const before = {};
    placeOnWire(before, 'p1', { clearsAt: NOW });
    expect(before).toEqual({});
  });

  it('lists players soonest-to-clear first', () => {
    let w = placeOnWire({}, 'late', { clearsAt: NOW + 5 * DAY });
    w = placeOnWire(w, 'soon', { clearsAt: NOW + DAY });
    expect(wirePlayers(w, NOW).map((x) => x.playerId)).toEqual(['soon', 'late']);
  });

  it('omits already-expired players from the list', () => {
    const w = placeOnWire({}, 'gone', { clearsAt: NOW - 1 });
    expect(wirePlayers(w, NOW)).toEqual([]);
  });
});

describe('clearExpired', () => {
  it('sweeps the expired and keeps the rest', () => {
    let w = placeOnWire({}, 'gone', { clearsAt: NOW - 1 });
    w = placeOnWire(w, 'held', { clearsAt: NOW + DAY });
    const out = clearExpired(w, NOW);
    expect(out.cleared).toEqual(['gone']);
    expect(Object.keys(out.wire)).toEqual(['held']);
  });

  it('reports what cleared so it can be announced', () => {
    let w = placeOnWire({}, 'b', { clearsAt: NOW - 1 });
    w = placeOnWire(w, 'a', { clearsAt: NOW - 1 });
    expect(clearExpired(w, NOW).cleared).toEqual(['a', 'b']);
  });

  it('is empty-safe', () => {
    expect(clearExpired({}, NOW)).toEqual({ wire: {}, cleared: [] });
    expect(clearExpired(null, NOW)).toEqual({ wire: {}, cleared: [] });
  });
});

describe('acquisitions', () => {
  it('records how a player arrived', () => {
    const a = recordAcquisition({}, 'p1', { at: NOW, via: 'free_agency' });
    expect(a.p1).toEqual({ at: NOW, via: 'free_agency' });
  });

  it('defaults to a free-agency acquisition', () => {
    expect(recordAcquisition({}, 'p1', { at: NOW }).p1.via).toBe('free_agency');
  });

  it('forgets a player who left the roster', () => {
    const a = recordAcquisition({}, 'p1', { at: NOW });
    expect(forgetAcquisition(a, 'p1').p1).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const before = {};
    recordAcquisition(before, 'p1', { at: NOW });
    expect(before).toEqual({});
  });
});
