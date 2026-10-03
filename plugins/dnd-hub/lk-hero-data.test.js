// plugins/dnd-hub/lk-hero-data.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RACE_INFO, CLASS_INFO, ROLES, DIFFICULTIES, raceView, classView, sturdiness } from './lk-hero-data.js';

const races = JSON.parse(readFileSync(new URL('./dnd-srd/races.json', import.meta.url)));
const classes = JSON.parse(readFileSync(new URL('./dnd-srd/classes.json', import.meta.url)));

describe('hero data covers the SRD', () => {
  it('has every race and class, and nothing extra', () => {
    expect(Object.keys(RACE_INFO).sort()).toEqual(races.map(r => r.id).sort());
    expect(Object.keys(CLASS_INFO).sort()).toEqual(classes.map(c => c.id).sort());
  });
  it('uses only the allowed roles and difficulties, and a colour per race', () => {
    for (const c of Object.values(CLASS_INFO)) {
      expect(ROLES).toContain(c.role);
      expect(DIFFICULTIES).toContain(c.difficulty);
    }
    for (const r of Object.values(RACE_INFO)) expect(r.colour).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('never names the trademark', () => {
    const all = JSON.stringify([RACE_INFO, CLASS_INFO]);
    expect(all).not.toMatch(/D&D|Dungeons/);
  });
});

describe('raceView', () => {
  it('reads bonuses, speed and darkvision from the SRD', () => {
    const v = raceView(races.find(r => r.id === 'dwarf'));
    expect(v.badges).toEqual(['CON +2', '25 ft', 'Darkvision', RACE_INFO.dwarf.signature]);
    expect(v.name).toBe('Dwarf');
    expect(v.emblem).toBe('race-dwarf');
  });
  it('says +1 to every ability for a human', () => {
    expect(raceView(races.find(r => r.id === 'human')).badges[0]).toBe('+1 to every ability');
  });
});

describe('classView', () => {
  it('describes sturdiness from the hit die', () => {
    expect(sturdiness(12)).toBe('Very sturdy');
    expect(sturdiness(10)).toBe('Sturdy');
    expect(sturdiness(8)).toBe('Steady');
    expect(sturdiness(6)).toBe('Fragile');
    const v = classView(classes.find(c => c.id === 'wizard'));
    expect(v).toMatchObject({ name: 'Wizard', role: 'Magic', difficulty: 'Tricky', main: 'INT', sturdy: 'Fragile', emblem: 'class-wizard' });
  });
});
