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
  'leaders.json':             `${CORE}/leaders`,

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
  'athlete-overview.json':    'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477/overview',
  'sleeper-state.json':       'https://api.sleeper.app/v1/state/nfl',
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
