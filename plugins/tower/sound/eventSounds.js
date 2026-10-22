/**
 * Which sound each thing that happens in a round makes (spec §8.5). Pure. Things that happen to OTHER players
 * mostly make no sound here (their machines play their own); what reaches me does — a hit, ink, ice, a grapple,
 * a bomb going off on my screen.
 */
export function soundFor(ev, comboStep) {
  if (typeof ev === "string") {
    const map = {
      jump: "jump", land: "land", spring: "spring", punch: "swing", hurt: "hit", "shield-pop": "shieldBreak",
      out: "out", inked: "ink", iced: "slick", grappled: "grapple", swapped: "grapple",
    };
    const name = map[ev];
    return name ? { name } : null;
  }
  if ("combo" in ev) return { name: "combo", n: comboStep + 2 };
  if ("crate" in ev) return { name: "crate" };
  if ("used" in ev) {
    const map = { updraft: "updraft", shield: "shieldUp", ink: "ink", slick: "slick", grapple: "grapple", bomb: "swing" };
    return { name: map[ev.used] };
  }
  if ("boom" in ev) return { name: "bomb" };
  return null;
}
