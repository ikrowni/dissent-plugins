/** The HUD's pure pieces: words for the playstyles, times, rows and the result card (tower-hud.js draws them). */

/** Plain names for the playstyles (spec §3.4). */
export const MODE_NAMES = {
  race: "First to the top", last: "Last standing", chaos: "Chaos", nohit: "No hitting", koth: "King of the hill",
};

/** The right-hand column of a standings or result row, in the playstyle's own terms. */
export function rowRight(mode, p) {
  if (mode === "last") return p.outMs !== null ? `out at ${fmtTime(p.outMs)}` : "still standing";
  if (mode === "koth") return `${fmtTime(p.crownMs ?? 0)} on the crown`;
  return p.finishedMs !== null ? fmtTime(p.finishedMs) : `floor ${p.floor}`;
}

export const fmtTime = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
};

const ordinal = (n) => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/**
 * The node's result as rows and a title, from my seat. The node settled the round from the players' reports
 * (Dissent spec 2026-10-20-tower-plugin-design §3): `places` best first, ties sharing a place, each with the label
 * this game reported ("1:42.3", "Floor 87"); `disputed` when the reports didn't agree.
 */
export function resultCard(res, mode, selfId, nameOf, colorOf) {
  if (res.disputed) return { rows: [], title: "No result", note: "The players' reports didn't match, so nobody wins this round." };
  if (!res.places?.length) return { rows: [], title: "No result", note: "Nobody's game reported this round." };
  const rows = res.places.map((p) => ({
    id: p.user_id,
    place: p.place,
    name: nameOf(p.user_id) + (p.user_id === selfId ? " (you)" : ""),
    color: colorOf(p.user_id),
    right: p.label ?? "",
  }));
  const winner = res.places[0];
  const mine = res.places.find((p) => p.user_id === selfId);
  const tie = res.places.filter((p) => p.place === 1).length > 1;
  const name = nameOf(winner.user_id);
  if (mode === "last" && res.places.length > 1) {
    return { rows, title: tie ? "A tie" : winner.user_id === selfId ? "Last one standing!" : `${name} was last standing` };
  }
  if (mode === "koth") {
    const title = (winner.score ?? 0) <= 0 ? "Nobody held the crown" : tie ? "A tie for the crown"
      : winner.user_id === selfId ? "You held the crown!" : `${name} held the crown`;
    return { rows, title };
  }
  const reached = !(winner.label ?? "").startsWith("Floor");
  const title = res.places.length === 1 ? (reached ? "You reached the top" : winner.label ?? "")
    : !reached ? "Nobody reached the top"
    : tie ? "A tie for first"
    : winner.user_id === selfId ? "You won!"
    : mine ? `${ordinal(mine.place)} place` : `${name} won`;
  return { rows, title };
}

/** The line under the result: whether this round can pay a Sparks prize (the node decided; the server's game_win rule
 *  decides whether it pays anything). */
export function prizeLine(res, winnerName) {
  return res.prize ? `If this server gives Sparks for game wins, ${winnerName} gets them.` : "No Sparks prize for this round.";
}
