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
/** Top 5 of the ranked featured list — the spotlight rail. `featured` returns up to 12. */
export function spotlightRail(clips) {
  return (clips || []).slice(0, 5);
}

/** A quiet week must not gut the landing. When `week` returns nothing, the caller
 *  refetches `all` once (clips === null signals "go fetch") and relabels the ribbon. */
export function resolveWindow(requested, clips) {
  if (requested === "week" && (!clips || !clips.length)) {
    return { window: "all", clips: null, fellBack: true };
  }
  return { window: requested, clips: clips || [], fellBack: false };
}

/** Muted autoplay and hover use the small rendition when it exists; real playback
 *  (click, lightbox) always uses the full-quality original with audio. */
export function previewSource(clip, muted) {
  if (!clip) return "";
  if (muted && clip.preview_url) return clip.preview_url;
  return clip.video_url || "";
}

export function contributorStats(clips) {
  const count = clips.length;
  const rated = clips.filter(c => (c.rating_count || 0) > 0);
  const avg = rated.length ? rated.reduce((s, c) => s + (c.avg_rating || 0), 0) / rated.length : 0;
  const totalRatings = clips.reduce((s, c) => s + (c.rating_count || 0), 0);
  return { count, avg, totalRatings };
}
