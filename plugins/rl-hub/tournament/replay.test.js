import { describe, it, expect } from 'vitest';
import { replay, canManage, KIND } from './replay.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({
  dissentUserId: `u${i + 1}`, displayName: `p${i + 1}`, mmr: 1000 - i,
}));

let _id = 0;
const entry = (author_id, data) => ({ id: ++_id, author_id, data, created_at: 't' });
const reset = () => { _id = 0; };

const create = (author, over = {}) => entry(author, {
  kind: KIND.CREATE, id: 'T1', name: 'Cup', gameMode: '1v1', bestOf: 3,
  participants: players(4), ...over,
});
const result = (author, roundIdx, matchIdx, s1, s2, tid = 'T1') =>
  entry(author, { kind: KIND.RESULT, tournamentId: tid, roundIdx, matchIdx, s1, s2 });

describe('replay — creation', () => {
  it('returns nothing for an empty log', () => {
    expect(replay([]).tournament).toBeNull();
    expect(replay(undefined).tournament).toBeNull();
  });

  it('builds a bracket from a create entry', () => {
    reset();
    const { tournament } = replay([create('org')]);
    expect(tournament.name).toBe('Cup');
    expect(tournament.rounds).toHaveLength(2);
  });

  // The core property: authority comes from the node's attestation, not from anything the
  // client put in the payload.
  it('takes the organiser from the attested author, not the payload', () => {
    reset();
    const e = create('real-organiser', { organiserId: 'liar', createdBy: 'liar' });
    const { tournament } = replay([e]);
    expect(tournament.organiserId).toBe('real-organiser');
  });

  it('rejects a malformed create', () => {
    reset();
    const { tournament, rejected } = replay([create('org', { participants: [] })]);
    expect(tournament).toBeNull();
    expect(rejected).toHaveLength(1);
  });

  it('lets a later create supersede an earlier tournament', () => {
    reset();
    const { tournament } = replay([
      create('org-a'),
      create('org-b', { id: 'T2', name: 'Second' }),
    ]);
    expect(tournament.name).toBe('Second');
    expect(tournament.organiserId).toBe('org-b');
  });

  it('replays in id order regardless of the order supplied', () => {
    reset();
    const c = create('org');
    const r = result('org', 0, 0, 2, 1);
    const forwards = replay([c, r]).tournament;
    const backwards = replay([r, c]).tournament;
    expect(backwards.rounds[0].matches[0].winnerId)
      .toBe(forwards.rounds[0].matches[0].winnerId);
  });
});

describe('replay — authorisation', () => {
  it('accepts a result from the organiser', () => {
    reset();
    const { tournament, rejected } = replay([create('org'), result('org', 0, 0, 2, 1)]);
    expect(rejected).toHaveLength(0);
    expect(tournament.rounds[0].matches[0].winnerId).toBeTruthy();
  });

  // The forgery this whole primitive exists to stop.
  it('refuses a result from anyone else, and says why', () => {
    reset();
    const { tournament, rejected } = replay([create('org'), result('impostor', 0, 0, 2, 1)]);
    expect(tournament.rounds[0].matches[0].winnerId).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/organiser/);
  });

  it('refuses an entry whose author was erased', () => {
    reset();
    // author_id is NULL once the user is deleted — unattributed cannot be authorised.
    const { rejected } = replay([create('org'), result(null, 0, 0, 2, 1)]);
    expect(rejected[0].reason).toMatch(/organiser/);
  });

  it('refuses a delete from a non-organiser', () => {
    reset();
    const { tournament, rejected } = replay([
      create('org'),
      entry('impostor', { kind: KIND.DELETE, tournamentId: 'T1' }),
    ]);
    expect(tournament).not.toBeNull();
    expect(rejected[0].reason).toMatch(/organiser/);
  });

  it('accepts a delete from the organiser', () => {
    reset();
    const { tournament } = replay([
      create('org'),
      entry('org', { kind: KIND.DELETE, tournamentId: 'T1' }),
    ]);
    expect(tournament).toBeNull();
  });

  it('does not let a previous organiser act on a later tournament', () => {
    reset();
    const { tournament, rejected } = replay([
      create('org-a'),
      create('org-b', { id: 'T2' }),
      result('org-a', 0, 0, 2, 1, 'T2'),
    ]);
    expect(tournament.rounds[0].matches[0].winnerId).toBeNull();
    expect(rejected.some(r => /organiser/.test(r.reason))).toBe(true);
  });
});

describe('replay — validation', () => {
  it('refuses an impossible score even from the organiser', () => {
    reset();
    // Attestation answers WHO, never WHETHER IT IS SANE. Both checks are needed.
    const { tournament, rejected } = replay([create('org'), result('org', 0, 0, 2, 2)]);
    expect(tournament.rounds[0].matches[0].winnerId).toBeNull();
    expect(rejected).toHaveLength(1);
  });

  it('refuses a result for a match that does not exist', () => {
    reset();
    const { rejected } = replay([create('org'), result('org', 99, 99, 2, 1)]);
    expect(rejected[0].reason).toMatch(/no such match/);
  });

  it('refuses a result for a match with no opponents yet', () => {
    reset();
    // Round 1 of a 4-player draw is unresolved, so the final has nobody in it.
    const { rejected } = replay([create('org'), result('org', 1, 0, 2, 1)]);
    expect(rejected[0].reason).toMatch(/opponents/);
  });

  it('refuses a result aimed at a different tournament', () => {
    reset();
    const { rejected } = replay([create('org'), result('org', 0, 0, 2, 1, 'OTHER')]);
    expect(rejected[0].reason).toMatch(/not current/);
  });

  it('refuses an unknown entry kind rather than ignoring it', () => {
    reset();
    const { rejected } = replay([create('org'), entry('org', { kind: 'mystery' })]);
    expect(rejected[0].reason).toMatch(/unknown entry kind/);
  });
});

describe('replay — progression', () => {
  it('propagates winners into the next round', () => {
    reset();
    const { tournament } = replay([
      create('org'),
      result('org', 0, 0, 2, 0),
      result('org', 0, 1, 2, 0),
    ]);
    const final = tournament.rounds[1].matches[0];
    expect(final.player1).not.toBeNull();
    expect(final.player2).not.toBeNull();
  });

  it('tracks the last entry applied, so callers can page from it', () => {
    reset();
    const { tournament } = replay([create('org'), result('org', 0, 0, 2, 1)]);
    expect(tournament.lastEntryId).toBe(2);
  });

  it('is deterministic — the same log always yields the same state', () => {
    reset();
    const log = [create('org'), result('org', 0, 0, 2, 1), result('org', 0, 1, 2, 0)];
    expect(JSON.stringify(replay(log).tournament))
      .toBe(JSON.stringify(replay(log).tournament));
  });
});

describe('canManage', () => {
  it('is true only for the attested organiser', () => {
    reset();
    const { tournament } = replay([create('org')]);
    expect(canManage(tournament, 'org')).toBe(true);
    expect(canManage(tournament, 'someone')).toBe(false);
  });

  it('is false with no tournament or no viewer', () => {
    expect(canManage(null, 'org')).toBe(false);
    expect(canManage({ organiserId: 'org' }, null)).toBe(false);
  });
});
