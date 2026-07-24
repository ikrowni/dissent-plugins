import assert from "node:assert";
import { sortClips, deriveTagChips, reelNext } from "./gallery-logic.mjs";

const clips = [
  { attachment_id: "a", created_at: "2026-07-20", duration_secs: 10, featured: false, stars: 3, tags: ["goal"] },
  { attachment_id: "b", created_at: "2026-07-24", duration_secs: 30, featured: true, stars: 9, tags: ["save"] },
  { attachment_id: "c", created_at: "2026-07-22", duration_secs: 5, featured: false, stars: 1, tags: [] },
];

assert.deepEqual(sortClips(clips, "newest").map(c => c.attachment_id), ["b", "c", "a"]);
assert.deepEqual(sortClips(clips, "oldest").map(c => c.attachment_id), ["a", "c", "b"]);
assert.deepEqual(sortClips(clips, "stars").map(c => c.attachment_id), ["b", "a", "c"]);
assert.deepEqual(sortClips(clips, "longest").map(c => c.attachment_id), ["b", "a", "c"]);
assert.deepEqual(deriveTagChips(clips).sort(), ["goal", "save"]);
assert.equal(reelNext(0, 3), 1);
assert.equal(reelNext(2, 3), 0);
console.log("ok");
