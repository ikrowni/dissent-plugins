// plugins/lk-secrets.test.js
import { describe, it, expect } from 'vitest';
import { splitCampaign, joinCampaign, publicPayload, isCampaignDm, secretKey, receivedToken, receivedPins, withoutStubs } from './lk-secrets.js';

const camp = () => ({
  id: 'c1', name: 'Lighthouse', dmUserId: 'dm', members: ['bob'],
  dmNotes: 'The keeper is the cultist', encounters: { e1: { name: 'Drowned' } }, scenes: { s1: { name: 'Shore' } },
  journals: {
    j1: { id: 'j1', title: 'Shared', visibility: 'player' },
    j2: { id: 'j2', title: 'Plot', visibility: 'dm' },
  },
  items: { i1: { name: 'Rope' } },
  maps: {
    m1: {
      id: 'm1', walls: [[0, 0, 1, 1]],
      tokens: {
        player_bob: { id: 'player_bob', type: 'player', visible: true },
        g1: { id: 'g1', type: 'monster', visible: false, hp: 7 },
        g2: { id: 'g2', type: 'monster', visible: true, hp: 7 },
      },
      triggers: [{ id: 't1', cx: 3, cy: 4, type: 'trap', label: 'Pit' }],
      pins: [{ id: 'p1', visible: 'all' }, { id: 'p2', visible: 'dm', note: 'secret door' }],
    },
    m2: { id: 'm2', tokens: {}, triggers: [], pins: [] },
  },
});

describe('splitCampaign', () => {
  it('moves every secret kind out of the public record', () => {
    const { pub, sec } = splitCampaign(camp());
    expect(pub.dmNotes).toBeUndefined();
    expect(pub.encounters).toBeUndefined();
    expect(pub.scenes).toBeUndefined();
    expect(Object.keys(pub.journals)).toEqual(['j1']);
    expect(Object.keys(pub.maps.m1.tokens).sort()).toEqual(['g2', 'player_bob']);
    expect(pub.maps.m1.triggers).toEqual([]);
    expect(pub.maps.m1.pins.map(p => p.id)).toEqual(['p1']);
    expect(pub.maps.m1.walls).toEqual([[0, 0, 1, 1]]);
    expect(pub.items).toEqual({ i1: { name: 'Rope' } });
    expect(pub.secretsKept).toBe(true);

    expect(sec.dmNotes).toBe('The keeper is the cultist');
    expect(Object.keys(sec.journals)).toEqual(['j2']);
    expect(Object.keys(sec.maps.m1.tokens)).toEqual(['g1']);
    expect(sec.maps.m1.triggers).toHaveLength(1);
    expect(sec.maps.m1.pins.map(p => p.id)).toEqual(['p2']);
    expect(sec.maps.m2).toBeUndefined(); // nothing secret on m2
  });

  it('has no secret part for a campaign with nothing secret', () => {
    const { pub, sec } = splitCampaign({ id: 'c', maps: { m: { tokens: { a: { id: 'a', visible: true } }, pins: [] } } });
    expect(sec).toBeNull();
    expect(pub.maps.m.tokens.a).toBeTruthy();
  });

  it('does not change its input', () => {
    const c = camp();
    const before = JSON.stringify(c);
    splitCampaign(c);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('a revealed token goes public on the next split', () => {
    const c = camp();
    c.maps.m1.tokens.g1.visible = true;
    const { pub, sec } = splitCampaign(c);
    expect(pub.maps.m1.tokens.g1).toBeTruthy();
    expect(sec.maps.m1.tokens).toBeUndefined();
  });
});

describe('joinCampaign', () => {
  it('round-trips a split', () => {
    const c = camp();
    const { pub, sec } = splitCampaign(c);
    const back = joinCampaign(pub, sec);
    delete back.secretsKept;
    const pinIds = m => m.pins.map(p => p.id).sort();
    expect(pinIds(back.maps.m1)).toEqual(['p1', 'p2']);
    back.maps.m1.pins = c.maps.m1.pins = [];
    expect(back).toEqual(c);
  });

  it('with no secret part is the public record', () => {
    const pub = { id: 'c', maps: {} };
    expect(joinCampaign(pub, null)).toEqual(pub);
  });

  it('drops a secret map the public record no longer has (the map was deleted)', () => {
    const { pub, sec } = splitCampaign(camp());
    delete pub.maps.m1;
    expect(joinCampaign(pub, sec).maps.m1).toBeUndefined();
  });

  it('a token present in both (revealed elsewhere) keeps the public copy', () => {
    const { pub, sec } = splitCampaign(camp());
    pub.maps.m1.tokens.g1 = { id: 'g1', visible: true, hp: 3 };
    expect(joinCampaign(pub, sec).maps.m1.tokens.g1).toEqual({ id: 'g1', visible: true, hp: 3 });
  });
});

describe('publicPayload', () => {
  it('reduces hidden tokens in a spawn to their id', () => {
    const out = publicPayload('tokens:spawn', { campaignId: 'c', tokens: [{ id: 'g1', visible: false, name: 'Ghoul' }, { id: 'b', visible: true, name: 'Bob' }] });
    expect(out.tokens).toEqual([{ id: 'g1', visible: false }, { id: 'b', visible: true, name: 'Bob' }]);
  });

  it('does not send a move of a hidden token', () => {
    const ctx = { isHidden: id => id === 'g1' };
    expect(publicPayload('token:move', { tokenId: 'g1' }, ctx)).toBeNull();
    expect(publicPayload('token:move', { tokenId: 'b' }, ctx)).toEqual({ tokenId: 'b' });
    expect(publicPayload('token:move', { tokenId: 'g1' })).toEqual({ tokenId: 'g1' }); // no map known: unchanged
  });

  it('sends only shared pins', () => {
    const out = publicPayload('pins:update', { pins: [{ id: 'p1', visible: 'all' }, { id: 'p2', visible: 'dm' }] });
    expect(out.pins).toEqual([{ id: 'p1', visible: 'all' }]);
  });

  it('a pending trap names no trap and no square', () => {
    const out = publicPayload('trigger:pending', { type: 'trigger:pending', campaignId: 'c', triggerId: 't1', tokenId: 'b', cx: 3, cy: 4, label: 'Pit' });
    expect(out).toEqual({ type: 'trigger:pending', campaignId: 'c', triggerId: 't1', tokenId: 'b' });
  });

  it('leaves other events alone', () => {
    const p = { a: 1 };
    expect(publicPayload('dice:roll', p)).toBe(p);
  });
});

describe('helpers', () => {
  it('isCampaignDm', () => {
    expect(isCampaignDm({ dmUserId: 'dm' }, 'dm')).toBe(true);
    expect(isCampaignDm({ dmUserId: 'dm' }, 'bob')).toBe(false);
    expect(isCampaignDm({ dmUserId: 'dm' }, null)).toBe(false);
    expect(isCampaignDm(null, 'dm')).toBe(false);
  });
  it('secretKey', () => expect(secretKey('c1')).toBe('dm-camp-c1'));
});

describe('receiving a trimmed event', () => {
  it("on the DM's screen a stub hides the token, keeping its data; a player's screen drops it", () => {
    expect(receivedToken({ id: 'g', visible: true, hp: 7 }, { id: 'g', visible: false }, true)).toEqual({ id: 'g', visible: false, hp: 7 });
    expect(receivedToken({ id: 'g', visible: true, hp: 7 }, { id: 'g', visible: false }, false)).toBeUndefined();
    expect(receivedToken(undefined, { id: 'g', visible: false })).toBeUndefined();
    expect(receivedToken({ id: 'g', hp: 7 }, { id: 'g', visible: true, hp: 3 })).toEqual({ id: 'g', visible: true, hp: 3 });
  });
  it('a full hidden token (the DM sent it before this rule) is taken as it is', () => {
    expect(receivedToken({ id: 'g' }, { id: 'g', visible: false, hp: 2 })).toEqual({ id: 'g', visible: false, hp: 2 });
  });
  it('the DM keeps DM-only pins a pins update cannot carry; a player takes the update', () => {
    const mine = [{ id: 'a', visible: 'all' }, { id: 'd', visible: 'dm' }];
    const incoming = [{ id: 'b', visible: 'all' }];
    expect(receivedPins(mine, incoming, true).map(p => p.id)).toEqual(['b', 'd']);
    expect(receivedPins(mine, incoming, false).map(p => p.id)).toEqual(['b']);
  });
});

describe('stubs never replace a hidden monster', () => {
  it('join: the secret copy beats a hidden copy in the public record', () => {
    const { pub, sec } = splitCampaign(camp());
    pub.maps.m1.tokens.g1 = { id: 'g1', visible: false };
    expect(joinCampaign(pub, sec).maps.m1.tokens.g1).toEqual({ id: 'g1', type: 'monster', visible: false, hp: 7 });
  });
  it('withoutStubs drops stubs and keeps real tokens', () => {
    const c = { maps: { m: { tokens: { g: { id: 'g', visible: false }, b: { id: 'b', visible: true } } } } };
    expect(Object.keys(withoutStubs(c).maps.m.tokens)).toEqual(['b']);
    expect(Object.keys(c.maps.m.tokens)).toEqual(['g', 'b']);
  });
});
