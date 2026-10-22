import { describe, expect, it } from "vitest";
import { layoutMarkers } from "./markers.js";
import { WL, WR } from "./tuning.js";

describe("edge markers", () => {
  it("never overlap and stay inside the walls", () => {
    const out = layoutMarkers([
      { id: "a", label: "▲ bob 3", x: 600, w: 90, up: true },
      { id: "b", label: "▲ charlie 3", x: 610, w: 110, up: true },
      { id: "c", label: "▲ KROWN 9", x: 605, w: 100, up: true },
      { id: "d", label: "▼ dee 2", x: 10, w: 80, up: false },
    ]);
    const up = out.filter((m) => m.up).sort((a, b) => a.x - b.x);
    for (let i = 1; i < up.length; i++) expect(up[i].x - up[i].w / 2).toBeGreaterThanOrEqual(up[i - 1].x + up[i - 1].w / 2);
    for (const m of out) {
      expect(m.x - m.w / 2).toBeGreaterThanOrEqual(WL - 0.001);
      expect(m.x + m.w / 2).toBeLessThanOrEqual(WR + 0.001);
    }
  });
});
