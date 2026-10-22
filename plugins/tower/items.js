/**
 * The pick-ups (spec §3.6). What you get from a crate depends on your place when you open it (Mario Kart's
 * rule): the fewer players behind you, the weaker the item. Grapple has a cooldown. Pure.
 */

export const ITEM_INFO = {
  updraft: { name: "Updraft", glyph: "⇑", code: 1 },
  shield: { name: "Shield", glyph: "◈", code: 2 },
  grapple: { name: "Grapple", glyph: "⤴", code: 3 },
  ink: { name: "Ink", glyph: "✺", code: 4 },
  slick: { name: "Slick", glyph: "❄", code: 5 },
  bomb: { name: "Bomb", glyph: "●", code: 6 },
};

export const itemByCode = (code) =>
  (Object.keys(ITEM_INFO)).find((k) => ITEM_INFO[k].code === code) ?? null;

/** The odds table (spec §3.6): front / middle / back. */
export const ODDS = {
  front: { updraft: 1, shield: 4, ink: 3, slick: 3 },
  middle: { updraft: 3, shield: 2, ink: 2, slick: 2, bomb: 2 },
  back: { updraft: 4, shield: 1, grapple: 3, bomb: 2 },
};
export const CHAOS_ODDS = { updraft: 2, shield: 1, ink: 2, slick: 2, bomb: 4, grapple: 3 };
/** No hitting, and alone: only what helps you. */
export const HELP_ODDS = { updraft: 3, shield: 2 };

/** Where you stand among the players still in: 0 = first, 1 = last; null alone. */
export function placeShare(place, playersIn) {
  return playersIn > 1 ? (place - 1) / (playersIn - 1) : null;
}

export function band(share) {
  return share < 1 / 3 ? "front" : share > 2 / 3 ? "back" : "middle";
}

/** The odds you open a crate with. */
export function oddsFor(mode, share, grappleReady) {
  let w = share === null || mode === "nohit" ? HELP_ODDS : mode === "chaos" ? CHAOS_ODDS : ODDS[band(share)];
  if (!grappleReady && w.grapple) {
    w = { ...w };
    delete w.grapple;
  }
  return w;
}

/** One draw from weights, with r() in [0, 1). */
export function draw(w, r) {
  const entries = Object.entries(w);
  let x = r() * entries.reduce((s, [, n]) => s + n, 0);
  for (const [k, n] of entries) if ((x -= n) < 0) return k;
  return entries[entries.length - 1][0];
}
