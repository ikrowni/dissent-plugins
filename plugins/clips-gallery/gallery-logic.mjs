export function sortClips(clips, mode) {
  const c = clips.slice();
  if (mode === "oldest") return c.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (mode === "rating") return c.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));
  if (mode === "longest") return c.sort((a, b) => (b.duration_secs || 0) - (a.duration_secs || 0));
  return c.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest
}
export function deriveTagChips(clips) {
  const set = new Set();
  clips.forEach(c => (c.tags || []).forEach(t => set.add(t)));
  return [...set];
}
export function reelNext(i, n) { return (i + 1) % n; }
export function topRatedClip(clips) {
  if (!clips || !clips.length) return null;
  const rated = clips.filter(c => (c.rating_count || 0) > 0);
  if (rated.length) return rated.reduce((a, b) => (b.avg_rating || 0) > (a.avg_rating || 0) ? b : a);
  return clips.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}
export function contributorStats(clips) {
  const count = clips.length;
  const rated = clips.filter(c => (c.rating_count || 0) > 0);
  const avg = rated.length ? rated.reduce((s, c) => s + (c.avg_rating || 0), 0) / rated.length : 0;
  const totalRatings = clips.reduce((s, c) => s + (c.rating_count || 0), 0);
  return { count, avg, totalRatings };
}
