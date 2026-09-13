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

  // 🔴 The node caps a plugin's declared resources at 16 MB in TOTAL (registry_integrity.go
  // maxResourceTotal — a mirroring-node security bound). Full-size art came to 49.6 MB.
  it('🔴 sizes every image to fit the 16 MB plugin budget, never upscaling', () => {
    const geom = (id) => jobs.find((j) => j.id === id).resize;
    expect(geom('card:BASH')).toBe('300x>');
    expect(geom('monster:AEONGLASS')).toBe('320x320>');
    expect(geom('relic:AKABEKO')).toBe('160x160>');
    for (const j of jobs) expect(j.resize, j.id).toMatch(/>$/);
  });

  // Upgraded images would double the card budget (~6 MB) and put the plugin over the cap.
  // The view shows upgraded TEXT on the base art; a larger cap would only need a rebuild.
  it('ships no separate upgraded card images', () => {
    expect(jobs.some((j) => j.id.startsWith('card-upg:'))).toBe(false);
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
  });
});
