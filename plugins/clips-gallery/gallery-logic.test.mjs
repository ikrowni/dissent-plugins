import assert from "node:assert";
import { sortClips, deriveTagChips, reelNext, topRatedClip, contributorStats } from "./gallery-logic.mjs";

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
