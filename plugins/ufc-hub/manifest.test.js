import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const DEAD = [
  // JS proof-of-work bot challenge: HTTP 200, 2,998 bytes, zero fighter rows. A
  // server-side proxy cannot execute JS, so this can never work. Measured 2026-08-08.
  'ufcstats.com',
  // Reads config.odds_api_key, but config_schema is null — the key can never be supplied.
  'api.the-odds-api.com',
];

describe('no dead fetch domain is declared anywhere', () => {
  for (const p of [
    './manifest.json',
    '../ufc-fights/manifest.json',
    '../ufc-news-sidebar/manifest.json',
  ]) {
    it(`${p} declares no dead domain`, () => {
      const m = read(p);
      for (const d of DEAD) {
        expect(m.allowed_fetch_domains ?? []).not.toContain(d);
      }
    });
  }
});

describe('ufc-hub manifest', () => {
  it('declares exactly the four domains it fetches, and no more', () => {
    // ⚠️ Editing this list changes NOTHING in production on its own.
    // `allowed_fetch_domains` is enforced from `server_plugins` — the per-install
    // snapshot — so a new domain also needs a migration for `registry_plugins` and a
    // second one for live installs. Adding a domain here without those means the
    // plugin's own fetches are rejected at runtime with no clue why.
    expect(read('./manifest.json').allowed_fetch_domains).toEqual([
      'site.api.espn.com',            // month index -> event ids, athletes, flags
      'd29dxerjsp82wz.cloudfront.net', // the card itself
      'gamma-api.polymarket.com',      // implied odds
      // ⚠️ www ONLY. hostAllowed is an EXACT match applied to every redirect hop, so
      // this does not admit `ufc.com` — and does not need to: core/ufc-links.js
      // normalises every URL to www, and the images on those pages go through the
      // image proxy, which is allowlist-free.
      'www.ufc.com',                   // athlete career stats + event artwork
    ]);
  });

  it('declares storage:user, which the cf-id cache needs', () => {
    expect(read('./manifest.json').declared_permissions).toContain('storage:user');
  });
});
