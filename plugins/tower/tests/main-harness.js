// A fake Dissent around tower-main.js, for its tests: the app's side of the SDK (requests answered from `answers`),
// its events, and the animation frames, driven by hand. In tests/, so it is never served or hashed.
import { vi } from "vitest";

export const ME = "00000000-0000-4000-8000-00000000000a";
export const BOB = "00000000-0000-4000-8000-00000000000b";

/** A table in round `round`, as `games.lobby` answers. */
export function lobbyOf(over = {}) {
  return {
    id: "lobby-1", status: "playing", seed: 12345, round: 1, elapsed_ms: 0, started_at: new Date().toISOString(),
    host_id: ME, settings: { mode: "race", floors: 50 },
    members: [{ user_id: ME, name: "alice", role: "player", seat: 0 }, { user_id: BOB, name: "bob", role: "player", seat: 1 }],
    you: { user_id: ME, role: "player", seat: 0 }, ...over,
  };
}

/**
 * Boots tower-main.js inside the fake app. `answers[action]` is a value, a function of the params, or an Error
 * (the app refuses). Returns the requests it sent and handles to drive it.
 */
export async function boot(answers) {
  const sent = [];
  const fakeParent = {
    postMessage(msg) {
      if (msg?.type !== "dissent:request") return;
      sent.push(msg);
      const a = answers[msg.action];
      if (a === undefined) return; // the app never answers: the SDK's timeout
      queueMicrotask(() => {
        let r = typeof a === "function" ? a(msg.params) : a;
        const data = r instanceof Error ? { type: "dissent:response", id: msg.id, ok: false, error: r.message }
          : { type: "dissent:response", id: msg.id, ok: true, data: r };
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    },
  };
  Object.defineProperty(window, "parent", { configurable: true, get: () => fakeParent });
  Object.defineProperty(globalThis, "parent", { configurable: true, get: () => fakeParent });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  HTMLCanvasElement.prototype.getContext = () => null;
  const frames = [];
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  document.body.innerHTML = '<canvas id="view" tabindex="0"></canvas><div id="hud"></div>';

  const { TowerAudio } = await import("../sound/towerAudio.js");
  const setVolume = vi.spyOn(TowerAudio.prototype, "setVolume");
  await import("../tower-main.js");

  let ts = 1000;
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const app = {
    sent,
    setVolume,
    tower: () => window.__tower,
    of: (action) => sent.filter((m) => m.action === action),
    post: async (data) => { window.dispatchEvent(new MessageEvent("message", { data })); await settle(); },
    event: (event, data) => app.post({ type: "dissent:event", event, data }),
    init: () => app.post({ type: "dissent:init", context: { contextType: "games", lobbyId: "lobby-1" } }),
    /** Runs `ms` of animation frames, 16 ms apart, letting replies arrive between them. */
    run: async (ms) => {
      for (let t = 0; t < ms; t += 16) {
        ts += 16;
        for (const cb of frames.splice(0)) cb(ts);
        await settle();
      }
    },
    button: (name) => [...document.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name),
    key: (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key })),
  };
  return app;
}
