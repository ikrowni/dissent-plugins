// core/runList.js — every run summary in the saves, page by page.

/** Rust clamps `limit` to 1–100 (game_saves/sts2/mod.rs). */
export const PAGE = 100;
/** A guard, not a limit anyone reaches: 100 pages is 10,000 runs. */
const MAX_PAGES = 100;

/** `{ status: 'ok', runs, skipped }` newest first, or `{ status }` when the saves answer anything else. */
export async function listRunSummaries(saves) {
  const runs = [];
  let skipped = 0;
  let before;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await saves('runs', { limit: PAGE, ...(before ? { before } : {}) });
    if (r?.status !== 'ok') return { status: r?.status ?? 'error' };
    runs.push(...r.runs);
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
  return { status: 'ok', runs, skipped };
}
