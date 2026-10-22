// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { soundFor } from "./eventSounds.js";
import { MELODY, noteName, PENTATONIC_A_MINOR } from "./ascent.js";
import { SOUNDS } from "./towerSounds.js";
import { DEFAULT_PREFS, readPrefs, writePrefs } from "./towerAudio.js";

describe("the Tower's sounds", () => {
  it("🔴 game sounds are the game's own (owner, 2026-10-20: they must not sound like Dissent's): nothing in the Tower imports from outside its folder but the SDK", () => {
    const root = join(__dirname, "..");
    const files = [...readdirSync(root).map((f) => join(root, f)), ...readdirSync(__dirname).map((f) => join(__dirname, f))]
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(m[1] === "../plugin-sdk.js" || m[1].startsWith("./") || (f.includes("/sound/") && m[1].startsWith("../") && !m[1].startsWith("../../")), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });

  it("every event that should make a sound makes the picked one", () => {
    expect(soundFor("jump", 0)?.name).toBe("jump");
    expect(soundFor("hurt", 0)?.name).toBe("hit");
    expect(soundFor("punch", 0)?.name).toBe("swing");
    expect(soundFor({ crate: "bomb", strong: false }, 0)?.name).toBe("crate");
    expect(soundFor({ used: "shield" }, 0)?.name).toBe("shieldUp");
    expect(soundFor({ boom: { x: 0, y: 0 } }, 0)?.name).toBe("bomb");
    expect(soundFor({ combo: 9 }, 2)).toEqual({ name: "combo", n: 4 });
    expect(soundFor({ feed: "hi" }, 0)).toBeNull();
    for (const s of Object.values(SOUNDS)) expect(typeof s.play).toBe("function");
  });

  it("the melody never leaves A minor pentatonic, so nothing clashes", () => {
    for (const bar of MELODY) for (const [, n] of bar) expect(PENTATONIC_A_MINOR).toContain(noteName(n));
    expect(MELODY).toHaveLength(8);
    for (const bar of MELODY) for (const [b,, d] of bar) expect(b + d).toBeLessThanOrEqual(4); // fits its bar
  });
});

describe("the player's audio preferences", () => {
  beforeEach(() => localStorage.clear());
  it("default to quiet music and sounds on; survive a reload; refuse nonsense", () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    writePrefs({ music: 0.6, sounds: false });
    expect(readPrefs()).toEqual({ music: 0.6, sounds: false });
    localStorage.setItem("dissent-tower-audio", JSON.stringify({ music: 7, sounds: "yes" }));
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("dissent-tower-audio", "{not json");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });
});
