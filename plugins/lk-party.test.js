import { describe, it, expect } from 'vitest';
import { heroStatus, hpBand, dmRows, playerStrip, dmPartyHtml, playerStripHtml, BAND_WIDTH } from './lk-party.js';

const bree = { name: 'Bree', class: 'rogue', level: 3, hp: 37, hpMax: 52, hpTemp: 4, ac: 17, passivePerception: 13,
  conditions: ['Prone'], dead: false, stable: false, portraitUrl: '', concentration: null, deathSaves: { successes: 0, failures: 0 } };
const ael = { name: 'Ael', class: 'cleric', level: 3, hp: 0, hpMax: 21, hpTemp: 0, ac: 18, passivePerception: 14,
  conditions: ['Unconscious'], dead: false, stable: false, portraitUrl: 'https://x/p.png', concentration: 'Bless',
  deathSaves: { successes: 1, failures: 2 } };
const summaries = { u1: bree, u2: ael, u3: { ...bree, name: 'Cid', hp: 30, hpMax: 30 } };

describe('heroStatus', () => {
  it('dead, stable, dying or nothing', () => {
    expect(heroStatus({ hp: 0, dead: true })).toBe('dead');
    expect(heroStatus({ hp: 0, stable: true })).toBe('stable');
    expect(heroStatus({ hp: 0 })).toBe('dying');
    expect(heroStatus({ hp: 5 })).toBe(null);
  });
});

describe('hpBand', () => {
  it('bands, never a number', () => {
    expect([[52, 52], [39, 52], [26, 52], [13, 52], [12, 52], [0, 52]].map(([h, m]) => hpBand(h, m)))
      .toEqual(['healthy', 'hurt', 'bloodied', 'critical', 'critical', 'down']);
    expect(hpBand(5, 0)).toBe('healthy'); // no max known yet
  });
});

describe('dmRows', () => {
  it('one row per member with a summary, in member order, with everything the DM needs', () => {
    const rows = dmRows(summaries, ['u2', 'u9', 'u1']);
    expect(rows.map(r => r.userId)).toEqual(['u2', 'u1']);
    expect(rows[0]).toMatchObject({ name: 'Ael', classLine: 'Cleric 3', hp: 0, hpMax: 21, ac: 18, passivePerception: 14,
      status: 'dying', statusText: 'Dying 1✓ 2✗', concentration: 'Bless', initial: 'A' });
    expect(rows[1]).toMatchObject({ hpTemp: 4, status: null, statusText: '' });
  });
  it('without a member list, every summary', () => {
    expect(dmRows(summaries).length).toBe(3);
  });
});

describe('playerStrip', () => {
  it('everyone but me, with a band and "down", and only whitelisted fields', () => {
    const strip = playerStrip(summaries, 'u3', ['u1', 'u2', 'u3']);
    expect(strip.map(e => e.userId)).toEqual(['u1', 'u2']);
    for (const e of strip) expect(Object.keys(e).sort()).toEqual(['band', 'conditions', 'down', 'initial', 'name', 'portraitUrl', 'userId']);
    expect(strip[0]).toMatchObject({ band: 'hurt', down: false });
    expect(strip[1]).toMatchObject({ band: 'down', down: true });
  });
  it('never contains HP, AC or passive Perception, in the data or in the HTML', () => {
    const strip = playerStrip(summaries, 'u3', ['u1', 'u2', 'u3']);
    const html = playerStripHtml(strip);
    for (const out of [JSON.stringify(strip), html]) {
      for (const secret of ['37', '52', '17', '13', '21', '18', '14', 'hpMax', 'passivePerception', '"ac"', 'Dying', '✓']) {
        expect([secret, out.includes(secret)]).toEqual([secret, false]);
      }
    }
    expect(html).toContain('Down');
    expect(html).toContain(`width:${BAND_WIDTH.hurt}%`);
  });
});

describe('HTML', () => {
  it('the DM rows show the numbers and open the editor', () => {
    const html = dmPartyHtml(dmRows(summaries, ['u1', 'u2']));
    expect(html).toContain('37/52');
    expect(html).toContain('+4');
    expect(html).toContain('AC 17');
    expect(html).toContain('PP 13');
    expect(html).toContain('Dying 1✓ 2✗');
    expect(html).toContain('Concentrating: Bless');
    expect(html).toContain(`onclick="openPartyMember('u1')"`);
  });
  it('escapes names and attributes', () => {
    const evil = { u1: { ...bree, name: '<img src=x onerror=alert(1)>', portraitUrl: '"><script>' } };
    for (const html of [dmPartyHtml(dmRows(evil)), playerStripHtml(playerStrip(evil, 'me'))]) {
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('"><script>');
    }
  });
  it('an empty party says so', () => {
    expect(dmPartyHtml([])).toContain('No heroes yet');
    expect(playerStripHtml([])).toBe('');
  });
});

describe('dmPartyHtml level buttons', () => {
  const sums = { u1: { name: 'Ann', class: 'fighter', level: 2, hp: 10, hpMax: 10 } };
  it('shows no button unless asked', () => {
    expect(dmPartyHtml(dmRows(sums, ['u1']))).not.toContain('levelUpHero');
  });
  it('shows Level up (milestone) or +XP (experience), and marks a waiting level', () => {
    expect(dmPartyHtml(dmRows(sums, ['u1']), { levelButton: true, byXp: false })).toContain("levelUpHero('u1')");
    expect(dmPartyHtml(dmRows(sums, ['u1']), { levelButton: true, byXp: true })).toContain("giveXpHero('u1')");
    expect(dmPartyHtml(dmRows(sums, ['u1']), { levelButton: true, waiting: () => true })).toContain('level waiting');
  });
});
