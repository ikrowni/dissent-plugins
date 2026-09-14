import { describe, it, expect } from 'vitest';
import { newPartyCode, normalizeCode, deriveParty, seal, openSealed } from './partyCrypto.js';

describe('party codes', () => {
  it('are 12 unambiguous characters in three groups, and random', () => {
    const a = newPartyCode();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newPartyCode()).not.toBe(a);
  });

  it('are read forgivingly: case, spaces, dashes, O for 0 and I or L for 1', () => {
    expect(normalizeCode(' k7q4 m2xp-9dol ')).toBe('K7Q4M2XP9D01');
    expect(normalizeCode('K7Q4-M2XP-9D0U')).toBeNull(); // U is not in the alphabet
    expect(normalizeCode('K7Q4-M2XP')).toBeNull();
  });
});

describe('deriveParty', () => {
  it('gives every member the same channel and key from the same code, however typed', async () => {
    const a = await deriveParty('K7Q4-M2XP-9D01');
    const b = await deriveParty('k7q4m2xp9dol');
    expect(a.channel).toBe(b.channel);
    expect(a.channel).toMatch(/^[a-f0-9]{32}$/);
    expect(await openSealed(b.key, await seal(a.key, { hello: 'party' }))).toEqual({ hello: 'party' });
  });

  // 🔴 The channel id is all the service sees of the code; it must not be the code or reveal the key.
  it('🔴 the channel is not the code, and another code cannot open what was sealed', async () => {
    const a = await deriveParty('K7Q4-M2XP-9D01');
    expect(a.channel).not.toContain('k7q4');
    const sealed = await seal(a.key, { deck: ['CARD.BASH'] });
    expect(sealed).not.toContain('BASH');
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const other = await deriveParty('K7Q4-M2XP-9D02');
    await expect(openSealed(other.key, sealed)).rejects.toThrow();
  });

  it('sealing the same thing twice gives different bytes (a fresh IV each time)', async () => {
    const { key } = await deriveParty('K7Q4-M2XP-9D01');
    expect(await seal(key, { a: 1 })).not.toBe(await seal(key, { a: 1 }));
  });
});
