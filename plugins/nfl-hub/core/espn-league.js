// core/espn-league.js — standings, injuries, news, odds and athlete parsers.
//
// Season-state variance is real here, so every accessor is defensive and every parser
// returns an empty/null value rather than throwing. A panel that throws blanks its
// parent (the bug fixed in dissent-plugins 79bd3d2).
import { teamByAbbr, logoPath } from './config.js';
import { urls } from './espn-client.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const stat = (stats, name) => (stats ?? []).find((s) => s.name === name);
const statNum = (stats, name) => num(stat(stats, name)?.value) ?? 0;
const statText = (stats, name) => stat(stats, name)?.displayValue ?? null;

/** { 'AFC East': Row[], ... } — eight divisions, four rows each.
 *
 *  Shape confirmed against the level=3 payload on 2026-08-07: children are the two
 *  conferences, each with four division groups whose `name` is ALREADY formatted as
 *  "AFC East", so it is used directly rather than reassembled. A level=2 payload has
 *  no division children and is deliberately ignored rather than mislabelled. */
export function parseStandings(json) {
  const out = {};
  for (const conf of json?.children ?? []) {
    for (const div of conf.children ?? []) {
      const key = String(div.name ?? '').trim();
      if (!/^(AFC|NFC) (East|North|South|West)$/.test(key)) continue;
      const rows = [];
      for (const entry of div.standings?.entries ?? []) {
        const abbr = entry.team?.abbreviation ?? '';
        if (!teamByAbbr(abbr)) continue;
        rows.push({
          abbr,
          name: entry.team?.shortDisplayName ?? abbr,
          fullName: entry.team?.displayName ?? abbr,
          logo: logoPath(abbr),
          wins: statNum(entry.stats, 'wins'),
          losses: statNum(entry.stats, 'losses'),
          ties: statNum(entry.stats, 'ties'),
          pct: statText(entry.stats, 'winPercent'),
          pointsFor: statNum(entry.stats, 'pointsFor'),
          pointsAgainst: statNum(entry.stats, 'pointsAgainst'),
          diff: statNum(entry.stats, 'differential'),
          streak: statText(entry.stats, 'streak'),
          // Real stat names, verified 2026-08-07. 'divisionRecord' carries "5-1" in its
          // displayValue while its numeric value is 0.0, so read displayValue. The
          // conference record's stat name genuinely contains spaces and a period.
          divRecord: statText(entry.stats, 'divisionRecord'),
          confRecord: statText(entry.stats, 'vs. Conf.'),
          overall: statText(entry.stats, 'overall'),
          seed: num(stat(entry.stats, 'playoffSeed')?.value),
        });
      }
      if (rows.length) {
        rows.sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses));
        out[key] = rows;
      }
    }
  }
  return out;
}

/** { PHI: Injury[], ... } from a game SUMMARY payload's injuries block.
 *
 *  NOT from the league-wide /injuries endpoint, which is 8.95 MB against a 1 MB cap
 *  (see espn-client.js). Each entry nests the team as an object —
 *  entry.team.abbreviation, not entry.abbreviation. Getting that wrong silently
 *  yields an empty map rather than an error, which is why a test pins it. */
export function parseInjuries(json) {
  const out = {};
  for (const entry of json?.injuries ?? []) {
    const abbr = entry.team?.abbreviation
      ?? teamByAbbr(entry.team?.displayName)?.abbr
      ?? '';
    if (!abbr) continue;
    const list = (entry.injuries ?? []).map((i) => ({
      athleteId: num(i.athlete?.id),
      name: i.athlete?.displayName ?? 'Unknown',
      position: i.athlete?.position?.abbreviation ?? null,
      status: i.status ?? null,
      // details.type is the body part ("Ankle", "Hamstring"); "Undisclosed" when unknown.
      detail: i.details?.type ?? null,
      returnDate: i.details?.returnDate ?? null,
    }));
    if (list.length) out[abbr] = list;
  }
  return out;
}

/** Injured athletes from a `teams/{id}?enable=roster` payload — how team pages get
 *  injury data, since the league-wide endpoint is unusable. */
export function parseRosterInjuries(json) {
  const athletes = json?.team?.athletes ?? [];
  const out = [];
  for (const a of athletes) {
    for (const i of a.injuries ?? []) {
      out.push({
        athleteId: num(a.id),
        name: a.displayName ?? 'Unknown',
        position: a.position?.abbreviation ?? null,
        jersey: a.jersey ?? null,
        status: i.status ?? i.type?.description ?? null,
        detail: i.details?.type ?? null,
        comment: i.shortComment ?? null,
        returnDate: i.details?.returnDate ?? null,
      });
    }
  }
  return out;
}

/** Accepts both shapes ESPN uses: the news endpoint wraps articles in
 *  { articles: [...] }, while an athlete overview's `news` is a bare array. */
export function parseNews(json) {
  const articles = Array.isArray(json) ? json : (json?.articles ?? []);
  return articles.map((a) => ({
    headline: a.headline ?? a.title ?? '',
    blurb: a.description ?? null,
    published: a.published ?? a.lastModified ?? null,
    link: a.links?.web?.href ?? null,
    image: a.images?.[0]?.url ?? null,
  }));
}

/** Null when nothing is published — the caller hides the strip rather than showing zeros. */
export function parseOdds(json) {
  const o = json?.items?.[0];
  if (!o) return null;
  return {
    provider: o.provider?.name ?? null,
    details: o.details ?? null,
    spread: num(o.spread),
    total: num(o.overUnder),
    homeMoneyline: num(o.homeTeamOdds?.moneyLine),
    awayMoneyline: num(o.awayTeamOdds?.moneyLine),
    homeFavorite: o.homeTeamOdds?.favorite === true,
  };
}

/** Parses the athlete OVERVIEW payload.
 *
 *  Note what this endpoint does NOT contain: there is no `athlete` key, so no bio —
 *  no height, weight, age, college or jersey. Verified 2026-08-07; its top-level keys
 *  are statistics, news, nextGame, gameLog, rotowire, awards, fantasy. A player page
 *  needing bio fields must fetch the athlete endpoint without /overview.
 *
 *  Two shapes need reworking rather than passing through:
 *   - statistics is a labels/values pairing (labels: ['CMP','ATT'], splits[].stats:
 *     ['315','502']), so it is zipped into name/value pairs here.
 *   - gameLog.events is a MAP keyed by event id, not a list. */
export function parseAthlete(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;

  const st = json.statistics ?? {};
  const labels = st.labels ?? st.names ?? [];
  const seasonStats = (st.splits ?? []).map((split) => ({
    label: split.displayName ?? '',
    stats: (split.stats ?? []).map((value, i) => ({
      name: labels[i] ?? String(i),
      value,
    })),
  }));

  const events = json.gameLog?.events ?? {};
  const gameLog = Array.isArray(events) ? events : Object.values(events);

  const f = json.fantasy ?? {};

  return {
    seasonStats,
    statLabels: labels,
    gameLog,
    news: parseNews(json.news ?? []),
    fantasy: {
      draftRank: num(f.draftRank),
      positionRank: num(f.positionRank),
      percentOwned: num(f.percentOwned),
    },
    rotowire: json.rotowire
      ? {
        headline: json.rotowire.headline ?? null,
        story: json.rotowire.story ?? json.rotowire.description ?? null,
        published: json.rotowire.published ?? null,
      }
      : null,
  };
}

/** Leaders, flattened to { key, label, leaders: [{ athleteId, name, teamAbbr, value, headshot }] }.
 *
 *  Reads the apis/site/v3 payload, whose athletes are inlined. sports.core.api's
 *  /leaders gives a bare $ref per athlete instead — ~250 extra fetches to learn any
 *  names. The categories array sits under a different key depending on the response
 *  wrapper, so look in both places. */
export function parseLeaders(json) {
  const cats = json?.leaders?.categories ?? json?.categories ?? [];
  const out = [];
  for (const c of cats) {
    const leaders = (c.leaders ?? []).map((l) => {
      const a = l.athlete ?? {};
      const id = num(a.id);
      return {
        athleteId: id,
        name: a.displayName ?? a.fullName ?? 'Unknown',
        position: a.position?.abbreviation ?? null,
        teamAbbr: l.team?.abbreviation ?? a.team?.abbreviation ?? null,
        value: l.displayValue ?? String(l.value ?? ''),
        headshot: id ? urls.headshot(id, 100) : null,
      };
    }).filter((l) => l.name !== 'Unknown');
    if (leaders.length) {
      out.push({
        key: c.name ?? '',
        label: c.displayName ?? c.shortDisplayName ?? c.name ?? '',
        leaders,
      });
    }
  }
  return out;
}

/** Bio from the athlete endpoint WITHOUT /overview — the only one carrying these fields.
 *  A player page pairs this with parseAthlete() for stats, fantasy ranks and news. */
export function parseAthleteBio(json) {
  const a = json?.athlete;
  if (!a || typeof a !== 'object') return null;
  const id = num(a.id);
  return {
    id,
    name: a.displayName ?? a.fullName ?? null,
    jersey: a.jersey ?? null,
    position: a.position?.abbreviation ?? null,
    teamAbbr: a.team?.abbreviation ?? null,
    teamName: a.team?.displayName ?? null,
    height: a.displayHeight ?? null,
    weight: a.displayWeight ?? null,
    age: num(a.age),
    college: a.college?.shortName ?? a.college?.name ?? null,
    experience: num(a.experience?.years),
    headshot: id ? urls.headshot(id, 200) : null,
  };
}
