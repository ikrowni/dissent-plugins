import { describe, it, expect } from 'vitest';
import {
  initials, positionColor, teamColor, avatar, teamMark, positionPill, playerChip, playerNote,
  managerColor, MANAGER_PALETTE, NEUTRAL_DUOTONE, POSITION_COLORS, POSITION_GROUP,
} from './player-visuals.js';

// Index records, the shape assets/players.index.json actually stores.
const mahomes = { n: 'Patrick Mahomes', p: 'QB', t: 'KC', e: 3139477 };
const noShot = { n: "Ja'Marr Chase", p: 'WR', t: 'CIN' };       // 4 in 5 look like this
const freeAgent = { n: 'Some Guy', p: 'RB', t: null };

describe('initials', () => {
  // ⚠️ First and last. The first two letters of a surname make every player
  // from one family tree identical.
  it('takes the first and last initial', () => {
    expect(initials('Patrick Mahomes')).toBe('PM');
    expect(initials("Ja'Marr Chase")).toBe('JC');
  });

  it('handles suffixes and middle names without picking them', () => {
    expect(initials('Odell Beckham Jr.')).toBe('OJ');
    expect(initials('A.J. Brown')).toBe('AB');
  });

  it('never returns nothing', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials('Cher')).toBe('CH');
  });
});

describe('colours', () => {
  it('gives every fantasy position its own colour', () => {
    const skill = ['QB', 'RB', 'WR', 'TE'].map(positionColor);
    expect(new Set(skill).size).toBe(4);
  });

  it('is case-insensitive, since indexes disagree about case', () => {
    expect(positionColor('qb')).toBe(positionColor('QB'));
  });

  it('falls back rather than returning undefined for an unknown position', () => {
    expect(positionColor('XYZ')).toBeTruthy();
    expect(positionColor(undefined)).toBeTruthy();
  });

  // ⚠️ THE POSITIONS THE LEADERS BOARD ACTUALLY CARRIES. Measured live
  // 2026-08-11: these five appear across six of the sixteen categories and none
  // of them is a key of POSITION_COLORS, so every one used to render grey.
  it('colours the real positions ESPN publishes, not just the fantasy buckets', () => {
    for (const p of ['DE', 'PK', 'S', 'CB', 'P']) {
      expect(positionColor(p)).not.toBe(positionColor('XYZ'));
    }
  });

  it('folds a real position onto the bucket it belongs to, inventing no new hue', () => {
    expect(positionColor('DE')).toBe(POSITION_COLORS.DL);
    expect(positionColor('CB')).toBe(POSITION_COLORS.DB);
    expect(positionColor('OLB')).toBe(POSITION_COLORS.LB);
    expect(positionColor('PK')).toBe(POSITION_COLORS.K);
    expect(positionColor('HB')).toBe(POSITION_COLORS.RB);
    // Every mapped value must already be a key of the scale, or the fold has
    // quietly become an invention.
    for (const bucket of Object.values(POSITION_GROUP)) {
      expect(POSITION_COLORS[bucket]).toBeTruthy();
    }
  });

  // ⚠️ An offensive lineman has no bucket. Guessing one is worse than grey.
  it('leaves a position it genuinely has no bucket for alone', () => {
    expect(positionColor('OT')).toBe('var(--text-3)');
    expect(positionColor('C')).toBe('var(--text-3)');
  });

  // ⚠️ Raw team primaries include #0b1c3a and #002a5c, which are invisible on a
  // near-black surface. legibleColor lifts them.
  it('lifts a dark team colour to something readable', () => {
    expect(teamColor('CHI')).not.toBe('#0b1c3a');
    expect(teamColor('CHI')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('avatar', () => {
  it('uses a real headshot when the player has an ESPN id', () => {
    const html = avatar(mahomes);
    expect(html).toContain('<img');
    expect(html).toContain('3139477');
  });

  // ⚠️ Only 19% of active players have an ESPN id. The monogram is the FINAL
  // state for most of them, not a placeholder.
  it('falls back to a monogram, at the same size, with no image request', () => {
    const html = avatar(noShot);
    expect(html).not.toContain('<img');
    expect(html).toContain('JC');
    expect(html).toContain('width:40px;height:40px');
  });

  it('renders both variants at the identical box so lists do not jump', () => {
    expect(avatar(mahomes, { size: 56 })).toContain('width:56px;height:56px');
    expect(avatar(noShot, { size: 56 })).toContain('width:56px;height:56px');
  });

  // ⚠️ A direct espncdn load is a CSP violation AND leaks the viewer's IP.
  it('routes the headshot through the image proxy, never espncdn directly', () => {
    const html = avatar(mahomes);
    expect(html).not.toMatch(/src="https:\/\/a\.espncdn\.com/);
  });

  it('keeps the monogram behind a broken headshot rather than showing a gap', () => {
    expect(avatar(mahomes)).toContain('onerror="this.remove()"');
    expect(avatar(mahomes)).toContain('PM');
  });
});

describe('teamMark', () => {
  it('shows the team logo and abbreviation', () => {
    const html = teamMark('KC');
    expect(html).toContain('logos/kc.png');
    expect(html).toContain('KC');
  });

  it('says FA rather than rendering a broken logo for no team', () => {
    expect(teamMark(null)).toContain('FA');
    expect(teamMark(null)).not.toContain('<img');
  });
});

describe('playerChip', () => {
  it('carries name, position and team', () => {
    const html = playerChip(mahomes);
    expect(html).toContain('Patrick Mahomes');
    expect(html).toContain('>QB<');
    expect(html).toContain('KC');
  });

  it('renders an em dash rather than throwing on a missing player', () => {
    expect(playerChip(null)).toContain('—');
  });

  it('escapes a name rather than injecting it', () => {
    const html = playerChip({ n: '<img src=x onerror=alert(1)>', p: 'QB', t: 'KC' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('takes an optional third line', () => {
    expect(playerChip(mahomes, { sub: 'ADP 1.02' })).toContain('ADP 1.02');
  });
});

describe('playerNote', () => {
  it('names the club', () => expect(playerNote(mahomes)).toBe('Kansas City Chiefs'));
  it('calls a teamless player a free agent', () => expect(playerNote(freeAgent)).toBe('Free agent'));
});

describe('opening the player page', () => {
  // ⚠️ The hub's player page is keyed on an ESPN athlete id. A chip that looks
  // tappable and does nothing is worse than a plain one.
  it('is clickable when the player has an ESPN id', () => {
    const html = playerChip(mahomes);
    expect(html).toContain('data-act="player-open"');
    expect(html).toContain('data-espn="3139477"');
    expect(html).toContain('role="button"');
  });

  it('is NOT clickable without one', () => {
    const html = playerChip(noShot);
    expect(html).not.toContain('data-act="player-open"');
    expect(html).not.toContain('role="button"');
  });

  it('is reachable by keyboard when it is clickable', () => {
    expect(playerChip(mahomes)).toContain('tabindex="0"');
    expect(playerChip(noShot)).not.toContain('tabindex');
  });
});

describe('managerColor', () => {
  it('is stable for the same team id', () => {
    expect(managerColor('t7')).toBe(managerColor('t7'));
  });

  it('is drawn from the fixed palette', () => {
    expect(MANAGER_PALETTE).toContain(managerColor('anything'));
  });

  it('spreads a twelve-team league over more than one colour', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `team-${i}`);
    expect(new Set(ids.map(managerColor)).size).toBeGreaterThan(3);
  });

  it('falls back to the neutral duotone for an unknown team', () => {
    // ⚠️ Spec §7: a colourless slab is worse than a deliberate neutral one.
    expect(managerColor(null)).toBe(NEUTRAL_DUOTONE);
    expect(managerColor('')).toBe(NEUTRAL_DUOTONE);
    expect(managerColor(undefined)).toBe(NEUTRAL_DUOTONE);
  });

  // ⚠️ PIGEONHOLE. A standard league is 12 teams and the standings table shows
  // every one at once. At eight hues at least four rows were FORCED to share a
  // colour, whatever the hash did. This does not make collisions impossible — it
  // stops them being guaranteed.
  it('has at least one hue per team in a standard twelve-team league', () => {
    expect(MANAGER_PALETTE.length).toBeGreaterThanOrEqual(12);
  });

  it('has no duplicate hues in the palette itself', () => {
    expect(new Set(MANAGER_PALETTE).size).toBe(MANAGER_PALETTE.length);
  });

  it('never collides with a position colour', () => {
    // ⚠️ Position colour is the board's primary encoding. A hero that happened to
    // be RB-green would read as a position rather than a team.
    const positions = new Set(Object.values(POSITION_COLORS).map((c) => c.toLowerCase()));
    for (const c of MANAGER_PALETTE) expect(positions.has(c.toLowerCase())).toBe(false);
  });
});
