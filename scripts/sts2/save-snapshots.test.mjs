// scripts/sts2/save-snapshots.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOURCES, sha256 } from './save-snapshots.mjs';

const provenance = JSON.parse(readFileSync(new URL('./fixtures/saves/provenance.json', import.meta.url)));

describe('the save snapshots', () => {
  // 🔴 The snapshots are only real while the projection and fixtures that made them are unchanged.
  it('🔴 were generated from the projection and fixtures as they are now', () => {
    const stale = SOURCES.filter((p) => provenance.sources[p] !== sha256(p));
    expect(stale, 'regenerate: node scripts/sts2/save-snapshots.mjs').toEqual([]);
  });

  it('cover every game.saves answer the plugin reads', () => {
    for (const f of ['current-run-entering', 'current-run-after', 'runs', 'run-1773796874', 'profile-stats']) {
      const v = JSON.parse(readFileSync(new URL(`./fixtures/saves/${f}.json`, import.meta.url)));
      expect(v.status, f).toBe('ok');
    }
  });
});
