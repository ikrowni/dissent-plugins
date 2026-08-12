#!/usr/bin/env node
// scripts/record-fixtures.mjs — snapshots real ESPN + Sleeper payloads into
// tests/fixtures/ so parsers can be tested and live-game UI developed out of season.
//
// Run from the plugin directory:  node scripts/record-fixtures.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../tests/fixtures/', import.meta.url);
const GAME = '401772510'; // DAL @ PHI, 2025 wk1 — 171 plays, 16 drives, 164 wp samples
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB2 = 'https://site.web.api.espn.com/apis/v2/sports/football/nfl';
const WEB3 = 'https://site.web.api.espn.com/apis/site/v3/sports/football/nfl';
const WEB  = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';

// Wave 3A. It is 2026 preseason week 1, so there is no live fantasy football — the same
// problem the replay harness solved for game center. Fixtures come from a COMPLETED 2025
// league so matchups carry real points, real bench/starter splits and a real bracket.
//
// Sunday Funday, verified public 2026-08-08: 12 teams, status "complete", PPR (rec 1.0),
// playoffs from week 15, and a SUPER_FLEX roster slot — the shape most likely to break
// naive slot labelling, which is why this league and not a vanilla one.
const SLEEPER = 'https://api.sleeper.app/v1';
const LEAGUE = '1182033380414181376';
const FWEEK = 14; // last regular-season week: full lineups, no playoff byes

const TARGETS = {
  'scoreboard-2025-wk1.json': `${SITE}/scoreboard?dates=2025&seasontype=2&week=1`,
  'scoreboard-current.json':  `${SITE}/scoreboard`,
  'summary-dalphi.json':      `${SITE}/summary?event=${GAME}`,
  'plays-dalphi.json':        `${CORE}/events/${GAME}/competitions/${GAME}/plays?limit=400`,
  'drives-dalphi.json':       `${CORE}/events/${GAME}/competitions/${GAME}/drives`,
  'probabilities-dalphi.json': `${CORE}/events/${GAME}/competitions/${GAME}/probabilities?limit=200`,
  'odds-dalphi.json':         `${CORE}/events/${GAME}/competitions/${GAME}/odds`,
  // NOT ${SITE}/standings. Measured 2026-08-07: that endpoint returns 86 bytes —
  // {"fullViewLink":{...}} and nothing else — at HTTP 200. The shipped v1 plugin calls
  // it, which is why its Standings tab renders nothing in production. A status-code
  // check passes it happily; only reading the body catches it.
  //
  // level=3 is what yields divisional grouping: level=2 gives two conferences of 16,
  // level=1 gives nothing, level=3 gives eight divisions of four. Group names come
  // back pre-formatted as "AFC East" etc.
  //
  // Recorded for 2025 (a completed season) so the fixture carries real records; at
  // runtime the hub passes the current season.
  'standings.json':           `${WEB2}/standings?season=2025&level=3`,
  'teams.json':               `${SITE}/teams`,
  'news.json':                `${SITE}/news?limit=25`,
  // NOT ${CORE}/leaders. That one references every athlete as a bare $ref, so a
  // leaders board would need 250 extra fetches to learn any names. The apis/site/v3
  // variant inlines the athlete (id, displayName, jersey, headshot, position).
  //
  // limit is load-bearing: the payload scales linearly and the unlimited response is
  // 2.44 MB against the 1 MB fetch:external cap. Measured 2026-08-08 —
  // limit=4 is 980 KB (only 7% headroom, one added ESPN field breaks it),
  // limit=3 is 737 KB (30% headroom). Take limit=3: 16 categories x top 3 = 48 leaders.
  'leaders.json':             `${WEB3}/leaders?limit=3`,

  // Wave 2. The athlete endpoint WITHOUT /overview is the one carrying bio fields —
  // jersey, displayHeight, displayWeight, age, college. /overview has no athlete key
  // at all (see espn-league.js parseAthlete).
  'athlete-bio.json':         `${WEB}/athletes/3139477`,
  'team-schedule-phi.json':   `${SITE}/teams/21/schedule`,
  // positions is a DICT keyed by position slug (lde, nt, rde…), not an array, and each
  // athlete is a $ref. The id in that $ref path resolves against team-roster-phi.json,
  // which is already fetched for team pages — so depth charts cost no extra requests.
  'depthchart-phi.json':      `${CORE}/seasons/2025/teams/21/depthcharts`,

  // Injuries come from these two, NOT from the league-wide /injuries endpoint.
  // Measured 2026-08-07: ${SITE}/injuries is 8.95 MB on the wire, nine times over the
  // 1 MB fetch:external cap, so it can never be loaded through the node proxy. The
  // per-team core-api variant (/teams/{id}/injuries) is worse still — it returns bare
  // $ref stubs, one fetch per injury.
  //
  // What works: the game summary already carries a full inline `injuries` block for
  // both teams (free — Game Center fetches summary anyway), and the team page with
  // ?enable=roster is 365 KB with an injuries array on each athlete.
  'team-roster-phi.json':     `${SITE}/teams/21?enable=roster`,
  'athlete-overview.json':    `${WEB}/athletes/3139477/overview`,
  'sleeper-state.json':       'https://api.sleeper.app/v1/state/nfl',

  // ⚠️ ONLY WHAT THE NATIVE LEAGUE STILL READS. The Sleeper MIRROR was removed on
  // 2026-08-12, and with it the rosters/users/matchups/projections recordings that
  // fed it. What is left is not the mirror: `sleeper-league.json` is the shape
  // `fromSleeperSettings` reads, and the stats below are what the native engine
  // scores from every week.
  'sleeper-league.json':       `${SLEEPER}/league/${LEAGUE}`,
  // The import path's real input: this endpoint returns FULL league objects —
  // settings, scoring_settings and roster_positions — so one request lists a
  // user's leagues AND carries everything fromSleeperSettings reads.
  'sleeper-user-leagues.json': `${SLEEPER}/user/1347854124514816000/leagues/nfl/2026`,

  // ACTUAL stats, same shape as projections but with what really happened.
  //
  // ⚠️ A NATIVE LEAGUE CANNOT USE pts_ppr / pts_std / pts_half_ppr. Those are
  // Sleeper's scoring applied for us; a league with custom scoring settings needs
  // the RAW fields (pass_yd, rec, fgm_50p, rush_td…) and must total them itself.
  // Measured 2026-08-09: 570 KB, 2,312 players, raw fields present. That is the
  // fact the whole native-scoring design depends on.
  'sleeper-stats-w14.json': `${SLEEPER}/stats/nfl/regular/2025/${FWEEK}`,
};

await mkdir(OUT, { recursive: true });

let fails = 0;
for (const [name, url] of Object.entries(TARGETS)) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Minified deliberately. These are committed and rsynced to the web server on
    // every deploy, and three of them are fetched at runtime by the replay harness.
    // Pretty-printing at indent 1 cost roughly 3x for no reader benefit — nothing
    // reads these by eye, tests parse them.
    const body = JSON.stringify(json);
    await writeFile(new URL(name, OUT), body);
    console.log(`ok   ${name} (${Math.round(body.length / 1024)} KiB)`);
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    fails += 1;
  }
}
process.exit(fails ? 1 : 0);
