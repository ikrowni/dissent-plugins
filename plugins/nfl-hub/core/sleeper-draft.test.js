import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDrafts, parseDraftPicks, draftBoard } from './sleeper-draft.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const drafts = parseDrafts(fx('sleeper-drafts.json'));
const picks = parseDraftPicks(fx('sleeper-draft-picks.json'));

describe('parseDrafts', () => {
  it('reads the league draft metadata', () => {
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      draftId: '1182033380414181377', status: 'complete', type: 'linear',
      rounds: 3, teams: 12, season: '2025',
    });
  });

  it('returns [] rather than throwing on a malformed payload', () => {
    expect(parseDrafts(null)).toEqual([]);
    expect(parseDrafts({})).toEqual([]);
  });
});

describe('parseDraftPicks', () => {
  it('parses every pick', () => {
    expect(picks).toHaveLength(36);
  });

  it('reads name and position from inline metadata, needing no player index', () => {
    expect(picks[0]).toMatchObject({
      pickNo: 1, round: 1, draftSlot: 1, rosterId: 6, playerId: '12527',
      name: 'Ashton Jeanty', position: 'RB', team: 'LV',
    });
  });

  it('treats a null is_keeper as not a keeper', () => {
    expect(picks[0].isKeeper).toBe(false);
  });

  it('survives a pick with no metadata at all', () => {
    const [p] = parseDraftPicks([{ pick_no: 4, round: 1, draft_slot: 4 }]);
    expect(p.name).toBe('Unknown');
    expect(p.position).toBe('');
  });
});

describe('draftBoard', () => {
  const board = draftBoard(picks);

  it('builds one row per round and one column per slot', () => {
    expect(board.rounds).toHaveLength(3);
    expect(board.slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(board.rounds[0].cells).toHaveLength(12);
  });

  it('places each pick at its own round and slot, so snake order needs no computing', () => {
    const cell = board.rounds[0].cells[0];
    expect(cell.pickNo).toBe(1);
    expect(cell.name).toBe('Ashton Jeanty');
  });

  it('maps each slot to the roster that drafted from it', () => {
    expect(board.slotRoster[1]).toBe(6);
  });

  it('leaves a gap null rather than shifting later picks left', () => {
    const sparse = draftBoard(parseDraftPicks([
      { pick_no: 1, round: 1, draft_slot: 1, roster_id: 1, metadata: { first_name: 'A', last_name: 'B' } },
      { pick_no: 3, round: 1, draft_slot: 3, roster_id: 3, metadata: { first_name: 'C', last_name: 'D' } },
    ]));
    expect(sparse.rounds[0].cells[1]).toBeNull();
    expect(sparse.rounds[0].cells[2].name).toBe('C D');
  });

  it('returns an empty board for no picks', () => {
    expect(draftBoard([])).toEqual({ rounds: [], slots: [], slotRoster: {} });
  });
});
