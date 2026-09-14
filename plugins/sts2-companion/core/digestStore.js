// core/digestStore.js — every finished run's digest, reading from the saves only what is new.
//
// The run LIST is always read fresh (cheap: summaries, up to 100 a call); a full run is read only when
// its digest is missing or was made by an older DIGEST_VERSION. Digests live in storage:local — a cache
// of what the saves already hold, so it never leaves the device and losing it costs one slow load.

import { runDigest, DIGEST_VERSION } from './digest.js';
import { listRunSummaries, PAGE } from './runList.js';

export const CACHE_KEY = 'insights:digests';
export { PAGE };

export async function loadDigests({ saves, local, data, onProgress = () => {} }) {
  // The cache is an optimisation. A device store that refuses (storage:local not yet approved after an
  // update, or unavailable) costs a slow load, never the section.
  const stored = await local.get(CACHE_KEY).catch(() => null);
  const valid = stored?.version === DIGEST_VERSION && stored.digests && typeof stored.digests === 'object';
  const cache = valid ? stored : { version: DIGEST_VERSION, digests: {} };
  // True only when the cache really changes: a reset, a new digest, or a forgotten run.
  let changed = !valid;

  const list = await listRunSummaries(saves);
  if (list.status !== 'ok') return { status: list.status };
  const ids = list.runs.map((x) => String(x.id));
  let { skipped } = list;

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
