import { describe, it, expect } from 'vitest';
import { PRESETS, RULE_KEYS, PRESET_ORDER, RULE_INFO, rule, presetOf, applyPreset, defaultSettings } from './lk-table-rules.js';
import { edition, EDITION_KEYS, applyPreset as applyP } from './lk-table-rules.js';

// The spec's table (2026-10-03 flow design §4), written out so a change to PRESETS must change this too.
const SPEC = {
  autoHit:               { guided: true,  classic: true,  raw: false },
  autoDamage:            { guided: true,  classic: false, raw: false },
  playersRollInitiative: { guided: true,  classic: true,  raw: true  },
  deathSaves:            { guided: true,  classic: true,  raw: false },
  concentrationAutoRoll: { guided: true,  classic: false, raw: false },
  trapSavesAuto:         { guided: true,  classic: false, raw: false },
  levelByXp:             { guided: false, classic: false, raw: false },
  flanking:              { guided: true,  classic: false, raw: false },
  featsAllowed:          { guided: true,  classic: true,  raw: true  },
  hints:                 { guided: true,  classic: false, raw: false },
};

describe('PRESETS', () => {
  it('match the spec table exactly', () => {
    expect(Object.keys(SPEC).sort()).toEqual([...RULE_KEYS].sort());
    for (const p of PRESET_ORDER) {
      expect(Object.keys(PRESETS[p]).sort()).toEqual([...RULE_KEYS].sort());
      for (const k of RULE_KEYS) expect([p, k, PRESETS[p][k]]).toEqual([p, k, SPEC[k][p]]);
    }
  });
  it('every switch has a label, a description and a group', () => {
    for (const k of RULE_KEYS) expect(RULE_INFO[k]).toMatchObject({ label: expect.any(String), desc: expect.any(String), group: expect.any(String) });
  });
});

describe('rule', () => {
  it('reads a stored switch', () => {
    expect(rule({ autoHit: false }, 'autoHit')).toBe(false);
  });
  it('gives a missing switch its Guided value, so old campaigns keep working', () => {
    expect(rule({}, 'trapSavesAuto')).toBe(true);
    expect(rule(undefined, 'playersRollInitiative')).toBe(true); // players roll their own (owner, 2026-10-05)
    expect(rule(null, 'hints')).toBe(true);
  });
  it('ignores a non-boolean value', () => {
    expect(rule({ hints: 'yes' }, 'hints')).toBe(true);
  });
});

describe('presetOf', () => {
  it('names each preset', () => {
    for (const p of PRESET_ORDER) expect(presetOf({ ...PRESETS[p], spatialRange: 40 })).toBe(p);
  });
  it('calls one changed switch custom', () => {
    expect(presetOf({ ...PRESETS.classic, hints: true })).toBe('custom');
  });
  it('treats no settings as Guided', () => {
    expect(presetOf(undefined)).toBe('guided');
  });
  it('shows the old default settings as custom (concentration was manual)', () => {
    const old = { autoHit: true, autoDamage: true, turnLock: false, deathSaves: true, spatialRange: 60, concentrationAutoRoll: false };
    expect(presetOf(old)).toBe('custom');
  });
  it('ignores the retired turn-lock switch (turn lock is always on in a fight now)', () => {
    expect(RULE_KEYS).not.toContain('turnLock');
    expect(presetOf({ ...PRESETS.guided, turnLock: false })).toBe('guided');
  });
});

describe('applyPreset', () => {
  it('resets every switch and keeps the other settings', () => {
    const s = applyPreset({ ...PRESETS.guided, hints: false, spatialRange: 90 }, 'raw');
    expect(presetOf(s)).toBe('raw');
    expect(s.spatialRange).toBe(90);
  });
  it('refuses an unknown preset', () => {
    expect(() => applyPreset({}, 'chaos')).toThrow();
  });
});

describe('defaultSettings', () => {
  it('is Guided with a 60 ft hearing range, and a fresh copy each time', () => {
    const a = defaultSettings();
    expect(presetOf(a)).toBe('guided');
    expect(a.spatialRange).toBe(60);
    a.hints = false;
    expect(defaultSettings().hints).toBe(true);
  });
});

describe('rules edition', () => {
  it('is off unless the DM turned it on, and no preset touches it', () => {
    expect(edition({}, 'origins2024')).toBe(false);
    expect(edition({ origins2024: true }, 'origins2024')).toBe(true);
    for (const p of ['guided', 'classic', 'raw']) expect(applyP({ weaponMastery: true }, p).weaponMastery).toBe(true);
    expect(EDITION_KEYS).toEqual(['origins2024', 'weaponMastery']);
  });
});
