// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAthlete, parseAthleteBio } from '../core/espn-league.js';
import { renderPlayer, statTable } from './player.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));
const s = {
  loading: false, error: null,
  bio: parseAthleteBio(fx('athlete-bio.json')),
  overview: parseAthlete(fx('athlete-overview.json')),
};
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('statTable', () => {
  it('renders a header per stat name and a row per split', () => {
    const el = parse(statTable(s.overview.seasonStats));
    expect(el.querySelector('table.grid')).not.toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(s.overview.seasonStats.length);
  });
  it('renders nothing for no splits', () => {
    expect(statTable([])).toBe('');
    expect(statTable(null)).toBe('');
  });
});

describe('renderPlayer', () => {
  it('renders loading, error and no-player states', () => {
    expect(parse(renderPlayer({ loading: true })).querySelector('.spinner')).not.toBeNull();
    expect(parse(renderPlayer({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
    expect(parse(renderPlayer({ bio: null })).textContent).toMatch(/choose a player/i);
  });

  it('renders the bio the overview endpoint cannot provide', () => {
    const txt = parse(renderPlayer(s)).textContent;
    expect(txt).toContain('Patrick Mahomes');
    expect(txt).toContain('Texas Tech');
    expect(txt).toMatch(/QB/);
    expect(txt).toContain('#15');
  });

  it('routes the headshot through the image proxy, never raw espncdn', () => {
    const src = parse(renderPlayer(s)).querySelector('img')?.getAttribute('src');
    expect(src).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
  });

  it('renders season stats and player news', () => {
    const txt = parse(renderPlayer(s)).textContent;
    expect(txt).toMatch(/season stats/i);
    expect(txt).toMatch(/player news/i);
  });

  it('links the player back to their team page', () => {
    const b = parse(renderPlayer(s)).querySelector('[data-act="team"]');
    expect(b).not.toBeNull();
    expect(b.dataset.team).toBe('KC');
  });

  it('still renders the bio when the overview failed entirely', () => {
    const el = parse(renderPlayer({ ...s, overview: null }));
    expect(el.textContent).toContain('Patrick Mahomes');
    expect(el.textContent).not.toMatch(/season stats/i);
  });

  it('never renders undefined', () => {
    expect(parse(renderPlayer(s)).textContent).not.toContain('undefined');
  });

  // ⚠️ THE PAGE KNEW HIS CLUB AND HIS POSITION AND USED NEITHER — both were on it
  // as plain text. The band tints by club, the pill carries the categorical
  // position scale: the two encodings the leaders board settled on.
  it('tints the band by club and pills the position', () => {
    const el = parse(renderPlayer(s));
    const band = el.querySelector('.pl-band');
    expect(band).not.toBeNull();
    expect(band.getAttribute('style')).toMatch(/--tc:\s*#[0-9a-f]{6}/i);
    expect(el.querySelector('.pl-band .pv-pos')).not.toBeNull();
    expect(el.querySelector('.pl-name').textContent).toBe(s.bio.name);
  });

  it('keeps the vitals it used to print, rather than losing them to the band', () => {
    const txt = parse(renderPlayer(s)).querySelector('.pl-band').textContent;
    for (const bit of [s.bio.college, s.bio.height].filter(Boolean)) {
      expect(txt).toContain(bit);
    }
  });

  it('survives a player with no club rather than painting an undefined colour', () => {
    const el = parse(renderPlayer({ ...s, bio: { ...s.bio, teamAbbr: null } }));
    expect(el.querySelector('.pl-band').getAttribute('style')).not.toMatch(/undefined/);
  });
});
