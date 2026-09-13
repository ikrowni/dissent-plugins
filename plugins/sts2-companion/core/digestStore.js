// core/digestStore.js — every finished run's digest, reading from the saves only what is new.
//
// The run LIST is always read fresh (cheap: summaries, up to 100 a call); a full run is read only when
// its digest is missing or was made by an older DIGEST_VERSION. Digests live in storage:local — a cache
// of what the saves already hold, so it never leaves the device and losing it costs one slow load.

import { runDigest, DIGEST_VERSION } from './digest.js';

export const CACHE_KEY = 'insights:digests';
/** Rust clamps `limit` to 1–100 (game_saves/sts2/mod.rs). */
export const PAGE = 100;
/** A guard, not a limit anyone reaches: 100 pages is 10,000 runs. */
const MAX_PAGES = 100;

export async function loadDigests({ saves, local, data, onProgress = () => {} }) {
  // The cache is an optimisation. A device store that refuses (storage:local not yet approved after an
  // update, or unavailable) costs a slow load, never the section.
  const stored = await local.get(CACHE_KEY).catch(() => null);
  const valid = stored?.version === DIGEST_VERSION && stored.digests && typeof stored.digests === 'object';
  const cache = valid ? stored : { version: DIGEST_VERSION, digests: {} };
  // True only when the cache really changes: a reset, a new digest, or a forgotten run.
  let changed = !valid;

  const ids = [];
  let skipped = 0;
  let before;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await saves('runs', { limit: PAGE, ...(before ? { before } : {}) });
    if (r?.status !== 'ok') return { status: r?.status ?? 'error' };
    ids.push(...r.runs.map((x) => String(x.id)));
    skipped += r.skipped ?? 0;
    // Same paging rule as views/history.js: next_before when the host sends it, else the last id.
    if ('next_before' in r) {
      if (r.next_before === null) break;
      before = r.next_before;
    } else {
      if (r.runs.length === 0 || r.runs.length + (r.skipped ?? 0) < PAGE) break;
      before = r.runs.at(-1).id;
    }
  }

  const missing = ids.filter((id) => !cache.digests[id]);
  let done = 0;
  for (const id of missing) {
    const run = await saves('run', { id });
    done += 1;
    onProgress({ done, total: missing.length });
    if (run?.status !== 'ok') { skipped += 1; continue; }
    cache.digests[id] = await runDigest(run, data);
    changed = true;
  }

  const present = new Set(ids);
  for (const id of Object.keys(cache.digests)) {
    if (!present.has(id)) { delete cache.digests[id]; changed = true; }
  }

  if (changed) await local.set(CACHE_KEY, cache).catch(() => {});
  return { status: 'ok', digests: ids.map((id) => cache.digests[id]).filter(Boolean), skipped };
}
