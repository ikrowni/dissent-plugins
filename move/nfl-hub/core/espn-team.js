// core/espn-team.js — team roster, depth chart and schedule parsers.
//
// Kept separate from espn-league.js, which is already at its size budget and covers a
// different concern (league-wide reference data).
import { teamByAbbr, logoPath, normalizeAbbr } from './config.js';
import { urls } from './espn-client.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Depth-chart athletes are $refs with the id in the path — same trick as teamIdFromRef. */
export function athleteIdFromRef(ref) {
  const url = typeof ref === 'string' ? ref : ref?.$ref;
  if (typeof url !== 'string') return null;
  const m = url.match(/\/athletes\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Athletes from a `teams/{id}?enable=roster` payload. */
export function parseTeamRoster(json) {
  const athletes = json?.team?.athletes ?? [];
  return athletes.map((a) => {
    const id = num(a.id);
    return {
      id,
      name: a.displayName ?? a.fullName ?? 'Unknown',
      jersey: a.jersey ?? null,
      position: a.position?.abbreviation ?? null,
      positionName: a.position?.displayName ?? null,
      height: a.displayHeight ?? null,
      weight: a.displayWeight ?? null,
      age: num(a.age),
      college: a.college?.shortName ?? a.college?.name ?? null,
      experience: num(a.experience?.years),
      headshot: id ? urls.headshot(id, 100) : null,
      injured: (a.injuries ?? []).length > 0,
    };
  });
}

/** Team identity + record from the same roster payload. */
export function parseTeamRecord(json) {
  const t = json?.team;
  if (!t) return null;
  const abbr = t.abbreviation ?? '';
  const known = teamByAbbr(abbr);
  const items = t.record?.items ?? [];
  const overall = items.find((i) => i.type === 'total') ?? items[0];
  return {
    abbr,
    teamId: num(t.id),
    name: t.name ?? known?.name ?? abbr,
    fullName: t.displayName ?? known?.fullName ?? abbr,
    logo: logoPath(abbr),
    primary: t.color ? `#${t.color}` : known?.primary ?? null,
    alt: t.alternateColor ? `#${t.alternateColor}` : known?.alt ?? null,
    record: overall?.summary ?? null,
    standingSummary: t.standingSummary ?? null,
    conf: known?.conf ?? null,
    div: known?.div ?? null,
  };
}

/**
 * Formations from a depthcharts payload.
 *
 * Two shape traps: `items[]` are formations ("Base 3-4 D", "Special Teams", "3WR 1TE"),
 * and each formation's `positions` is a DICT keyed by position slug (lde, nt, rde…), not
 * an array. Athletes are $refs; `roster` (from parseTeamRoster) resolves them with no
 * extra fetch, because team pages fetch the roster anyway.
 */
export function parseDepthChart(json, roster = []) {
  const byId = new Map((roster ?? []).map((a) => [a.id, a]));
  return (json?.items ?? []).map((formation) => {
    const positions = Object.entries(formation.positions ?? {}).map(([slug, p]) => ({
      slug,
      label: p.position?.displayName ?? p.position?.name ?? slug.toUpperCase(),
      abbr: p.position?.abbreviation ?? slug.toUpperCase(),
      athletes: (p.athletes ?? [])
        .map((entry) => {
          const id = athleteIdFromRef(entry.athlete);
          const known = id ? byId.get(id) : null;
          return {
            athleteId: id,
            rank: num(entry.rank) ?? 99,
            slot: num(entry.slot),
            name: known?.name ?? 'Unknown',
            jersey: known?.jersey ?? null,
            headshot: known?.headshot ?? null,
          };
        })
        .sort((a, b) => a.rank - b.rank),
    }));
    return { id: String(formation.id ?? ''), name: formation.name ?? '', positions };
  });
}

/** Schedule events flattened relative to `teamAbbr`, so W/L and opponent are computed
 *  once here rather than in the view. */
export function parseTeamSchedule(json, teamAbbr) {
  const me = normalizeAbbr(teamAbbr);
  return (json?.events ?? []).map((e) => {
    const c = e.competitions?.[0] ?? {};
    const competitors = c.competitors ?? [];
    const mine = competitors.find((x) => normalizeAbbr(x.team?.abbreviation) === me);
    const other = competitors.find((x) => x !== mine);
    const state = c.status?.type?.state ?? 'pre';
    const myScore = num(mine?.score);
    const theirScore = num(other?.score);
    return {
      id: String(e.id),
      state,
      startsAt: e.date ?? null,
      week: num(e.week?.number),
      weekText: e.week?.text ?? null,
      seasonType: num(e.seasonType?.id ?? e.seasonType),
      isHome: mine ? mine.homeAway === 'home' : null,
      opponentAbbr: other?.team?.abbreviation ?? null,
      opponentLogo: other?.team?.abbreviation ? logoPath(other.team.abbreviation) : null,
      myScore,
      theirScore,
      result: state === 'post' && myScore !== null && theirScore !== null
        ? (myScore > theirScore ? 'W' : myScore < theirScore ? 'L' : 'T')
        : null,
    };
  });
}
