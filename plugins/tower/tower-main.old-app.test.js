// @vitest-environment jsdom
// tower-main.js in an older app (desktop v1.2.385) that knows games.lobby and games.send but not games.sound,
// games.leaderboard or games.report (Dissent spec 2026-10-20-tower-plugin-design §5): the game must carry on.
import { beforeAll, describe, expect, it } from "vitest";
import { boot, BOB, lobbyOf } from "./tests/main-harness.js";
import { COUNT_MS, LEAD_MS } from "./tuning.js";

let app;
const unknown = (a) => new Error(`unknown action: ${a}`);

beforeAll(async () => {
  const lobby = lobbyOf();
  app = await boot({
    "games.lobby": () => lobby,
    "games.send": {},
    "games.sound": unknown("games.sound"),
    "games.leaderboard": unknown("games.leaderboard"),
    "games.report": unknown("games.report"),
  });
  await app.init();
});

describe("the Tower in an older app", () => {
  it("plays the round at full volume", async () => {
    expect(app.tower().round.round).toBe(1);
    await app.run(LEAD_MS + COUNT_MS * 3 + 200);
    expect(app.tower().round.started).toBe(true);
  });

  it("🔴 an app that doesn't know games.report is not asked again and again", async () => {
    app.key("Escape");
    app.button("Give up this round").click();
    await app.event("game.message", { from: BOB, data: { k: "quit", t: 100 } });
    await app.run(8000);
    expect(app.of("games.report")).toHaveLength(1);
    expect(app.tower().round.reported).toBe(true);
  });
});
