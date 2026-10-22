import { describe, expect, it } from "vitest";
import { prizeLine, resultCard } from "./hudParts.js";

// The node's RoundResult (Dissent spec 2026-10-20-tower-plugin-design §3) as the result card shows it.
const names = { me: "alice", bob: "bob", cee: "cee" };
const nameOf = (id) => names[id];
const colorOf = () => "#fff";
const place = (user_id, p, label, score = 1) => ({ user_id, place: p, label, score });

describe("resultCard", () => {
  it("a race: my place, the reported labels, ties", () => {
    const res = { round: 1, disputed: false, prize: true, places: [place("bob", 1, "1:02.4"), place("me", 2, "1:10.0"), place("cee", 3, "Floor 40")] };
    const c = resultCard(res, "race", "me", nameOf, colorOf);
    expect(c.title).toBe("2nd place");
    expect(c.rows.map((r) => r.right)).toEqual(["1:02.4", "1:10.0", "Floor 40"]);
    expect(c.rows[1].name).toBe("alice (you)");
    expect(resultCard({ ...res, places: [place("me", 1, "1:00.0"), place("bob", 1, "1:00.0")] }, "race", "me", nameOf, colorOf).title).toBe("A tie for first");
    expect(resultCard({ ...res, places: [place("me", 1, "Floor 30"), place("bob", 2, "Floor 20")] }, "race", "me", nameOf, colorOf).title).toBe("Nobody reached the top");
  });

  it("the other playstyles", () => {
    const res = { round: 1, disputed: false, prize: true, places: [place("bob", 1, "Lasted 2:10"), place("me", 2, "Lasted 1:00")] };
    expect(resultCard(res, "last", "me", nameOf, colorOf).title).toBe("bob was last standing");
    const crown = { ...res, places: [place("me", 1, "Crown 1:00", 60000), place("bob", 2, "Crown 0:20", 20000)] };
    expect(resultCard(crown, "koth", "me", nameOf, colorOf).title).toBe("You held the crown!");
  });

  it("no result: the reports didn't agree, or nobody reported", () => {
    const disputed = resultCard({ round: 1, disputed: true, prize: false, places: [] }, "race", "me", nameOf, colorOf);
    expect(disputed).toMatchObject({ title: "No result", rows: [] });
    expect(disputed.note).toMatch(/didn't match/);
    expect(resultCard({ round: 1, disputed: false, prize: false, places: [] }, "race", "me", nameOf, colorOf).note).toMatch(/Nobody/);
  });

  it("the prize line", () => {
    expect(prizeLine({ prize: true }, "bob")).toMatch(/game wins, bob gets them/);
    expect(prizeLine({ prize: false }, "bob")).toBe("No Sparks prize for this round.");
  });
});
