// scripts/sts2/normalize.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize, imageJobs } from './normalize.mjs';

const S = JSON.parse(readFileSync(new URL('./fixtures/export-sample.json', import.meta.url)));

describe('normalize', () => {
  const out = normalize(S);

  it('merges the rendered card images from the card API into the export', () => {
    const bash = out.cards.find((c) => c.id === 'BASH');
    expect(bash.image).toMatch(/^https:\/\/cdn\.spire-codex\.com\/cards-full\/.+bash\.webp$/);
    expect(bash.imageUpgraded).toMatch(/bash_upg\.webp$/);
    expect(bash.upgradeDescription).toContain('10');
  });

  it('keeps what the wiki shows and drops what it does not', () => {
    const bash = out.cards.find((c) => c.id === 'BASH');
    expect(bash).toMatchObject({ id: 'BASH', name: 'Bash', cost: 2, type: 'Attack', rarity: 'Basic', color: 'ironclad' });
    expect(bash).not.toHaveProperty('beta_image_url');
    expect(bash).not.toHaveProperty('description_raw');
  });

  it('carries monster move patterns', () => {
    const m = out.monsters.find((x) => x.id === 'AEONGLASS');
    expect(m.pattern.type).toBe('cycle');
    expect(m.pattern.description).toContain('→');
    expect(m.moves.length).toBeGreaterThan(0);
  });

  it('pins the game version and credits', () => {
    expect(out.meta.gameVersion).toBe(S.changelogs[0].game_version);
    expect(out.meta.source).toContain('spire-codex');
    expect(out.meta.copyright).toMatch(/Mega Crit/);
  });
});

describe('imageJobs', () => {
  const jobs = imageJobs(normalize(S));

  it('asks for base and upgraded card art, and resizes only monsters', () => {
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain('card:BASH');
    expect(ids).toContain('card-upg:BASH');
    expect(ids).toContain('relic:AKABEKO');
    expect(ids).toContain('monster:AEONGLASS');
    expect(jobs.find((j) => j.id === 'monster:AEONGLASS').resize).toBe(480);
    expect(jobs.find((j) => j.id === 'card:BASH').resize).toBeUndefined();
  });

  // ⚠️ Spire Codex lists upgraded URLs that 404 (WITHER, 2026-09-13). A missing UPGRADED image
  // must not fail the build: the Upgraded toggle keeps the base art.
  it('marks upgraded card art optional, and base art required', () => {
    expect(jobs.find((j) => j.id === 'card-upg:BASH').optional).toBe(true);
    expect(jobs.find((j) => j.id === 'card:BASH').optional).toBeUndefined();
  });

  it('resolves relative image URLs against spire-codex.com', () => {
    expect(jobs.find((j) => j.id === 'relic:AKABEKO').url).toBe('https://spire-codex.com/static/images/relics/akabeko.webp');
  });

  // ⚠️ Spire Codex documents cards whose rendered image is null. Portrait art is the fallback.
  it('falls back to portrait art when a card has no rendered image', () => {
    const n = normalize({ ...S, apiCards: S.apiCards.map((c) => (c.id === 'BASH' ? { ...c, image_url_card: null, image_url_card_upg: null } : c)) });
    const job = imageJobs(n).find((j) => j.id === 'card:BASH');
    expect(job.url).toBe('https://spire-codex.com/static/images/cards/bash.webp');
    expect(job.fallback).toBe(true);
    expect(imageJobs(n).some((j) => j.id === 'card-upg:BASH')).toBe(false);
  });
});
