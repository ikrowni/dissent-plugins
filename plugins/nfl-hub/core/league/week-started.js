/**
 * Has anything been played in this scored week yet?
 *
 * Scoring writes a record for the CURRENT week on its first tick — before a single
 * game kicks off — with every team on 0. Read as a result, that record is a 0–0 tie
 * in every matchup: standings handed every team a tie each week until Thursday
 * night (seen live 2026-09-30, week 4), and the playoff bracket, which breaks a tie
 * by seed, would have advanced every higher seed before kickoff and saved it.
 *
 * So a week counts once ANY team has a non-zero total. A real week where literally
 * every starter in the league scored exactly zero does not happen; an unplayed one
 * happens every week.
 *
 * @param {{ teams?: Record<string, { total?: number }> } | null} scores
 */
export function weekHasStarted(scores) {
  for (const rec of Object.values(scores?.teams ?? {})) {
    const t = Number(rec?.total);
    if (Number.isFinite(t) && t !== 0) return true;
  }
  return false;
}
