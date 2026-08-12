// core/sleeper-import.js — bring a Sleeper league's RULES into a native league.
//
// This is what replaced the Sleeper mirror. The mirror rendered a league that
// lived somewhere else and could only be read; this reads that league ONCE, maps
// its configuration onto ours, and creates a native league you can actually play.
// Nothing here talks to Sleeper again afterwards — there is no sync, and there is
// deliberately no way to write back.
//
// ⚠️ IT IMPORTS THE RULES AND NOTHING ELSE, and saying so is half the feature. A
// commissioner who imports a mid-season league and assumes their rosters came
// with it has been misled by us, not by Sleeper. `notImported()` below is the
// list, and the UI is required to show it.
//
// ⚠️ CLIENT-ONLY, NO SIGNATURE. `league:create` already accepts a full settings
// object and runs it through the module's own `normalizeSettings` +
// `validateSettings`, so the whole import is: fetch → map → create. Nothing in
// server/ changes and no module needs rebuilding.
import { getJson } from './http.js';
import {
  fromSleeperSettings, validateSettings, FORMAT, DEFAULT_SETTINGS,
} from './league/settings.js';

/** What our own default veto threshold is, so an adjustment can name it. */
const DEFAULT_VETO = DEFAULT_SETTINGS.vetoVotesNeeded;

const API = 'https://api.sleeper.app/v1';

export const importUrls = {
  user: (nameOrId) => `${API}/user/${encodeURIComponent(nameOrId)}`,
  // ⚠️ THIS ENDPOINT RETURNS FULL LEAGUE OBJECTS, settings, scoring_settings and
  // roster_positions included — measured against the live account 2026-08-12. So
  // listing somebody's leagues and reading one's rules is ONE request, not one
  // plus one per league.
  leagues: (userId, season) => `${API}/user/${userId}/leagues/nfl/${season}`,
  league: (leagueId) => `${API}/league/${leagueId}`,
};

/**
 * Pull a league id out of whatever the user pasted.
 *
 * ⚠️ PEOPLE PASTE URLs. A Sleeper league id is an 18-digit number nobody has
 * memorised, and the only place anyone ever sees one is the address bar —
 * `https://sleeper.com/leagues/1347854506179719168/team`. Demanding the bare id
 * means asking somebody to edit a URL by hand.
 */
export function parseLeagueInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  // ⚠️ THE SPORT SEGMENT IS OPTIONAL AND EASY TO MISS. A league link is
  // `/leagues/<id>/…` but a draft link is `/draft/nfl/<id>` — the first version of
  // this matched only the former and silently sent every draft URL down the
  // username path, where it became "no Sleeper account called https://…".
  const fromUrl = raw.match(/(?:leagues?|drafts?)\/(?:nfl\/)?(\d{6,25})/);
  if (fromUrl) return fromUrl[1];
  return /^\d{6,25}$/.test(raw) ? raw : null;
}

/** Resolve a Sleeper username (or user id) to their leagues for a season. */
export async function fetchSleeperLeagues(username, season) {
  const user = await getJson(importUrls.user(username));
  const id = user?.user_id;
  if (!id) return null;
  const leagues = await getJson(importUrls.leagues(id, season));
  return Array.isArray(leagues) ? leagues : [];
}

export const fetchSleeperLeague = (leagueId) => getJson(importUrls.league(leagueId));

/**
 * What this import cannot bring, in the order a commissioner would miss it.
 *
 * ⚠️ NOT A DISCLAIMER — a specification. Every line is something Sleeper holds
 * that our engine either cannot represent or must not invent. Team OWNERS are the
 * clearest case: a Sleeper user is not a Dissent user and there is no mapping
 * between them, so importing eight owners would mean inventing eight accounts.
 */
export function notImported() {
  return [
    'Rosters and players — every team starts empty, and you draft here.',
    'Draft results and pick history.',
    'Team owners — a Sleeper account is not a Dissent account, so managers join here themselves.',
    'Standings, matchups and transaction history.',
    'Divisions, and any co-owners.',
  ];
}

/**
 * Everything the import changed on the way in, so it can be shown rather than
 * discovered later.
 *
 * ⚠️ A SILENT ADJUSTMENT IS A LIE ABOUT WHAT WAS IMPORTED. Both live leagues on
 * the QA account needed one, and neither is exotic: Sleeper ships
 * `max_keepers: 1` on redraft leagues where it means nothing, and omits
 * `veto_votes_needed` so our own default of 6 leaks into a league with 4 teams.
 * Reporting an adjustment costs a line of text; not reporting it means a
 * commissioner finds out when a trade cannot be vetoed.
 */
export function adjustments(sleeperLeague, settings) {
  const s = sleeperLeague?.settings ?? {};
  const out = [];
  const rawKeepers = Number(s.max_keepers ?? 0);
  if (rawKeepers > 0 && settings.format === FORMAT.REDRAFT) {
    out.push(`Keepers turned off — Sleeper had ${rawKeepers}, which a redraft league cannot use.`);
  }
  // ⚠️ THE TWO VETO CASES ARE DIFFERENT AND MUST NOT BE COLLAPSED. Sleeper either
  // specified a threshold we had to reduce, or specified nothing and OUR default
  // did not fit — the sentence is different because the cause is.
  //
  // ⚠️ The first version compared against `rawVeto ?? Infinity`, and `n < Infinity`
  // is ALWAYS true — so every league with no `veto_votes_needed` reported a
  // reduction that never happened, printing "reduced to 6 — null is more teams
  // than the league has". Live-driving the real import is what showed it; the
  // unit tests only covered leagues where Sleeper DID specify one.
  const rawVeto = Number.isFinite(Number(s.veto_votes_needed)) ? Number(s.veto_votes_needed) : null;
  if (rawVeto !== null && settings.vetoVotesNeeded < rawVeto) {
    out.push(`Veto votes reduced to ${settings.vetoVotesNeeded} — Sleeper had ${rawVeto}, more than the league has teams.`);
  } else if (rawVeto === null && settings.vetoVotesNeeded < DEFAULT_VETO) {
    out.push(`Veto votes set to ${settings.vetoVotesNeeded} — Sleeper did not specify one and the league is smaller than our default of ${DEFAULT_VETO}.`);
  }
  return out;
}

/**
 * The whole read-side of an import: map, validate, and describe.
 *
 * Returns `{ ok, settings, adjustments, notImported, errors }`. The caller
 * creates the league; this decides whether it should.
 *
 * ⚠️ IT VALIDATES BEFORE OFFERING, because `league:create` validates too and
 * refuses. Until 2026-08-12 `fromSleeperSettings` had no caller at all, so its
 * output had never once been run through `validateSettings` — and when it finally
 * was, EVERY real league came back invalid. Checking here means a bad league is a
 * message, not a failed button.
 */
export function planImport(sleeperLeague) {
  if (!sleeperLeague || typeof sleeperLeague !== 'object') {
    return { ok: false, errors: ['That league could not be read from Sleeper.'] };
  }
  const settings = fromSleeperSettings(sleeperLeague);
  const check = validateSettings(settings);
  return {
    ok: check.valid,
    settings,
    errors: check.errors,
    adjustments: adjustments(sleeperLeague, settings),
    notImported: notImported(),
  };
}
