import { describe, expect, it } from "vitest";
import { band, draw, itemByCode, ITEM_INFO, oddsFor, placeShare } from "./items.js";
import { rng } from "./towerGen.js";

const sample = (w, n = 4000) => {
  const r = rng(7), c = {};
  for (let i = 0; i < n; i++) { const k = draw(w, r); c[k] = (c[k] ?? 0) + 1; }
  return c;
};

describe("pick-up odds by place", () => {
  it("first gets small defensive items, last the strong ones; only the back gets Grapple", () => {
    expect(band(placeShare(1, 4))).toBe("front");
    expect(band(placeShare(4, 4))).toBe("back");
    expect(band(placeShare(2, 3))).toBe("middle");
    const front = sample(oddsFor("race", 0, true)), back = sample(oddsFor("race", 1, true));
    expect(front.grapple ?? 0).toBe(0);
    expect(front.bomb ?? 0).toBe(0);
    expect(back.grapple ?? 0).toBeGreaterThan(600);
    expect(back.updraft ?? 0).toBeGreaterThan(front.updraft ?? 0);
    expect(front.shield ?? 0).toBeGreaterThan(back.shield ?? 0);
  });

  it("Grapple has a cooldown; No hitting and solo give only what helps you", () => {
    expect(sample(oddsFor("race", 1, false)).grapple ?? 0).toBe(0);
    for (const w of [oddsFor("nohit", 1, true), oddsFor("race", null, true)]) {
      expect(Object.keys(sample(w)).sort()).toEqual(["shield", "updraft"]);
    }
    expect(Object.keys(sample(oddsFor("chaos", 0, true))).sort()).toEqual(["bomb", "grapple", "ink", "shield", "slick", "updraft"]);
  });

  it("item codes round-trip (they travel in position messages)", () => {
    for (const k of Object.keys(ITEM_INFO)) expect(itemByCode(ITEM_INFO[k].code)).toBe(k);
    expect(itemByCode(0)).toBeNull();
  });
});
