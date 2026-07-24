import assert from "node:assert";
import { sortClips, deriveTagChips, reelNext, topRatedClip, contributorStats, spotlightRail, resolveWindow, previewSource } from "./gallery-logic.mjs";

const clips = [
  { attachment_id: "a", created_at: "2026-07-20", duration_secs: 10, featured: false, avg_rating: 3, tags: ["goal"] },
  { attachment_id: "b", created_at: "2026-07-24", duration_secs: 30, featured: true, avg_rating: 4.8, tags: ["save"] },
  { attachment_id: "c", created_at: "2026-07-22", duration_secs: 5, featured: false, avg_rating: 1, tags: [] },
];

assert.deepEqual(sortClips(clips, "newest").map(c => c.attachment_id), ["b", "c", "a"]);
assert.deepEqual(sortClips(clips, "oldest").map(c => c.attachment_id), ["a", "c", "b"]);
assert.deepEqual(sortClips(clips, "rating").map(c => c.attachment_id), ["b", "a", "c"]);
assert.deepEqual(sortClips(clips, "longest").map(c => c.attachment_id), ["b", "a", "c"]);
assert.deepEqual(deriveTagChips(clips).sort(), ["goal", "save"]);
assert.equal(reelNext(0, 3), 1);
assert.equal(reelNext(2, 3), 0);
console.log("ok");

const rc = [
  { attachment_id: "a", created_at: "2026-07-20", avg_rating: 3, rating_count: 2 },
  { attachment_id: "b", created_at: "2026-07-24", avg_rating: 4.8, rating_count: 5 },
  { attachment_id: "c", created_at: "2026-07-22", avg_rating: 0, rating_count: 0 },
];
assert.equal(topRatedClip(rc).attachment_id, "b");                       // highest avg among rated
assert.equal(topRatedClip([                                              // none rated → newest
  { attachment_id: "x", created_at: "2026-01-01", rating_count: 0 },
  { attachment_id: "y", created_at: "2026-02-01", rating_count: 0 },
]).attachment_id, "y");
assert.equal(topRatedClip([]), null);
const st = contributorStats(rc);
assert.equal(st.count, 3);
assert.equal(st.totalRatings, 7);
assert.ok(Math.abs(st.avg - 3.9) < 1e-9);                                // mean of rated (3, 4.8)
console.log("ok2");

// --- landing redesign: rail, window fallback, preview source ---
const feat = [
  { attachment_id: "1", avg_rating: 5.0 }, { attachment_id: "2", avg_rating: 4.5 },
  { attachment_id: "3", avg_rating: 4.2 }, { attachment_id: "4", avg_rating: 4.0 },
  { attachment_id: "5", avg_rating: 3.8 }, { attachment_id: "6", avg_rating: 3.1 },
];
// featured returns up to 12; the rail shows the top 5, in server (Bayesian) order.
assert.deepEqual(spotlightRail(feat).map(c => c.attachment_id), ["1", "2", "3", "4", "5"]);
assert.deepEqual(spotlightRail([]), []);
assert.deepEqual(spotlightRail(null), []);
assert.deepEqual(spotlightRail(feat.slice(0, 2)).map(c => c.attachment_id), ["1", "2"]);

// A populated week stays on week; an empty week signals a refetch of all-time.
assert.deepEqual(resolveWindow("week", [{ attachment_id: "1" }]),
  { window: "week", clips: [{ attachment_id: "1" }], fellBack: false });
assert.deepEqual(resolveWindow("week", []), { window: "all", clips: null, fellBack: true });
assert.deepEqual(resolveWindow("week", null), { window: "all", clips: null, fellBack: true });
// An empty all-time is genuinely empty — never loops back on itself.
assert.deepEqual(resolveWindow("all", []), { window: "all", clips: [], fellBack: false });

// Muted autoplay prefers the small rendition; real playback always uses the original.
assert.equal(previewSource({ video_url: "v", preview_url: "p" }, true), "p");
assert.equal(previewSource({ video_url: "v" }, true), "v");
assert.equal(previewSource({ video_url: "v", preview_url: "p" }, false), "v");
assert.equal(previewSource(null, true), "");
assert.equal(previewSource({}, true), "");
console.log("ok3");
