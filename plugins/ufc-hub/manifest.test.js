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
  it('declares only the two live domains', () => {
    expect(read('./manifest.json').allowed_fetch_domains).toEqual([
      'site.api.espn.com',
      'd29dxerjsp82wz.cloudfront.net',
    ]);
  });

  it('declares storage:user, which the cf-id cache needs', () => {
    expect(read('./manifest.json').declared_permissions).toContain('storage:user');
  });
});
