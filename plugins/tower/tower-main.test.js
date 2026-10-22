// @vitest-environment jsdom
// tower-main.js inside a fake Dissent (tests/main-harness.js): one table, played through in order — the countdown
// timed by the node's clock, the sound level, giving up, one report, the node's result, Play again and Leave.
import { beforeAll, describe, expect, it } from "vitest";
import { boot, BOB, lobbyOf, ME } from "./tests/main-harness.js";
import { COUNT_MS, LEAD_MS } from "./tuning.js";

const GO_MS = LEAD_MS + COUNT_MS * 3;
let app, lobby;

beforeAll(async () => {
  // 🔴 This PC's clock runs 9 s fast: by it, the round started 9 s ago. By the node's clock it has only just started.
  lobby = lobbyOf({ elapsed_ms: 0, started_at: new Date(Date.now() - 9000).toISOString() });
  app = await boot({
    "games.lobby": () => lobby,
    "games.sound": { volume: 1, deafened: false },
    "games.leaderboard": { wins: [], best: [] },
    "games.send": {},
    "games.report": () => lobby,
    "games.start": () => lobby,
    "games.leave": {},
  });
  await app.init();
});

describe("the Tower in a games frame", () => {
  it("asks the app for the sound level and the table, and starts the round from the table's seed", () => {
    expect(app.of("games.sound")).toHaveLength(1);
    expect(app.of("games.lobby").length).toBeGreaterThan(0);
    expect(app.tower().round.round).toBe(1);
    expect([...app.tower().round.others.keys()]).toEqual([BOB]);
  });

  it("🔴 times GO by the node's clock (elapsed_ms), not this PC's: a 9 s fast clock still sees the full countdown", async () => {
    expect(app.tower().round.started).toBe(false);
    expect(app.tower().round.raceMs).toBeLessThan(-GO_MS + 200);
    await app.run(GO_MS - 600);
    expect(app.tower().round.started).toBe(false);
    await app.run(800);
    expect(app.tower().round.started).toBe(true);
    expect(app.tower().said).toEqual(expect.arrayContaining(["3", "2", "1", "GO!"]));
  });

  it("follows the app's sound level and deafen", async () => {
    await app.event("game.sound", { volume: 0.4, deafened: true });
    expect(app.setVolume).toHaveBeenLastCalledWith(0.4, true);
  });

  it("sends my moves to the others through the relay", () => {
    expect(app.of("games.send").some((m) => m.params.data?.k === "p")).toBe(true);
  });

  it("🔴 reports once, and only when the round is over for everyone (not when I give up)", async () => {
    app.key("Escape");
    app.button("Give up this round").click();
    await app.run(3000); // bob is still climbing: the round isn't over, so nothing is reported
    expect(app.of("games.report")).toHaveLength(0);
    await app.event("game.message", { from: BOB, data: { k: "quit", t: 4000 } });
    await app.run(3000);
    const reports = app.of("games.report");
    expect(reports).toHaveLength(1);
    expect(reports[0].params.round).toBe(1);
    expect(reports[0].params.places.map((p) => p.user_id).sort()).toEqual([ME, BOB].sort());
    await app.run(2000);
    expect(app.of("games.report")).toHaveLength(1);
  });

  it("shows the node's result when the table carries this round's, and the host's Play again starts the next", async () => {
    lobby = lobbyOf({ status: "open", result: { round: 1, disputed: false, prize: true,
      places: [{ user_id: BOB, place: 1, score: 3, label: "Floor 3" }, { user_id: ME, place: 2, score: 0, label: "Floor 0" }] } });
    await app.event("game.lobby", { id: "lobby-1", status: "open" });
    expect(app.tower().hud.kind).toBe("result");
    expect(document.body.textContent).toContain("bob");
    app.button("Play again").click();
    await app.run(32);
    expect(app.of("games.start")).toHaveLength(1);
  });

  it("a new round from the node starts round 2 with a fresh tower", async () => {
    lobby = lobbyOf({ round: 2, seed: 777, elapsed_ms: 0 });
    await app.event("game.lobby", { id: "lobby-1", status: "playing" });
    expect(app.tower().round.round).toBe(2);
    expect(app.tower().hud.kind).toBe("none");
  });

  it("Leave gives the seat up through the app (games.leave)", async () => {
    app.button("Leave the game").click();
    await app.run(32);
    expect(app.of("games.leave")).toHaveLength(1);
  });
});
