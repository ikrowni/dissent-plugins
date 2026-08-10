import { describe, it, expect } from 'vitest';
import {
  initials, positionColor, teamColor, avatar, teamMark, positionPill, playerChip, playerNote,
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
