export function sortClips(clips, mode) {
  const c = clips.slice();
  if (mode === "oldest") return c.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (mode === "stars") return c.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  if (mode === "longest") return c.sort((a, b) => (b.duration_secs || 0) - (a.duration_secs || 0));
  return c.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest
}
export function deriveTagChips(clips) {
  const set = new Set();
  clips.forEach(c => (c.tags || []).forEach(t => set.add(t)));
  return [...set];
}
export function reelNext(i, n) { return (i + 1) % n; }
