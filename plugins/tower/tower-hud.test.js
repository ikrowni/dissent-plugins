// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hud } from "./tower-hud.js";

let host, on;
beforeEach(() => {
  document.body.innerHTML = '<div id="hud"></div>';
  host = document.getElementById("hud");
  on = { leave: vi.fn(), resume: vi.fn(), giveUp: vi.fn(), playAgain: vi.fn(), prefs: vi.fn() };
});

describe("the HUD", () => {
  it("🔴 other people's names go in as text, never markup", () => {
    const hud = new Hud(host, on);
    const evil = '<img src=x onerror="window.pwned=1">';
    hud.setCard({ kind: "result", title: "You won!", sub: "First to the top · 50 floors", rows: [{ id: "a", name: evil, color: "#fff", right: "1:00.0", place: 1 }],
      host: false, hostName: evil, prizeLine: "No Sparks prize for this round." });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain(evil);
    hud.note(evil);
    expect(host.querySelector("img")).toBeNull();
  });

  it("the menu: Resume, Give up when it can, Leave; the music slider reports the new level", () => {
    const hud = new Hud(host, on);
    hud.setCard({ kind: "menu", canGiveUp: true });
    const buttons = [...host.querySelectorAll(".tw-card button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Resume", "Give up this round", "Leave the game"]);
    const range = host.querySelector('input[type="range"]');
    range.value = "0.6";
    range.dispatchEvent(new Event("input"));
    expect(on.prefs).toHaveBeenCalledWith({ music: 0.6, sounds: true });
    hud.setCard({ kind: "menu", canGiveUp: false });
    expect([...host.querySelectorAll(".tw-card button")].map((b) => b.textContent)).not.toContain("Give up this round");
  });

  it("the result: Play again for the host, ties keep their place, Back to the games room leaves", () => {
    const hud = new Hud(host, on);
    hud.setCard({ kind: "result", title: "A tie for first", sub: "", rows: [{ id: "a", name: "alice", color: "#f00", right: "1:00.0", place: 1 },
      { id: "b", name: "bob (you)", color: "#0f0", right: "1:00.0", place: 1 }], host: true, hostName: "bob", prizeLine: "" });
    expect([...host.querySelectorAll(".tw-card li b")].map((b) => b.textContent)).toEqual(["1", "1"]);
    host.querySelector("button.pri").click();
    expect(on.playAgain).toHaveBeenCalled();
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Back to the games room").click();
    expect(on.leave).toHaveBeenCalled();
  });

  it("the stats and the banner log", () => {
    const hud = new Hud(host, on);
    hud.setHud({ floor: 12, floors: 50, place: "1 of 2", timeMs: 62_000, keysFaded: false, item: { glyph: "◆", name: "Shield" }, extra: null });
    expect(host.querySelector("[data-floor]").textContent).toBe("12 / 50");
    expect(host.querySelector("[data-time]").textContent).toBe("1:02.0");
    expect(host.querySelector("[data-item-box]").classList.contains("has")).toBe(true);
    hud.say("3"); hud.say("GO!");
    expect(hud.said).toEqual(["3", "GO!"]);
  });
});
