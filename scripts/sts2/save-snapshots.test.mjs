// scripts/sts2/save-snapshots.test.mjs
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MONOREPO, SOURCES, sha256 } from './save-snapshots.mjs';

// Provenance is checked against the Dissent repo's projection and fixtures, which a
// GitHub-hosted CI machine does not have — that failure blocked every plugin deploy from
// 2026-09-14 to 09-24. It still runs wherever the Dissent source is present.
const HAVE_MONOREPO = SOURCES.every((p) => existsSync(join(MONOREPO, p)));

const provenance = JSON.parse(readFileSync(new URL('./fixtures/saves/provenance.json', import.meta.url)));

describe('the save snapshots', () => {
  // 🔴 The snapshots are only real while the projection and fixtures that made them are unchanged.
  it.skipIf(!HAVE_MONOREPO)('🔴 were generated from the projection and fixtures as they are now', () => {
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
