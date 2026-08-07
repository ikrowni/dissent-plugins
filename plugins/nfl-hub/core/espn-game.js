// core/espn-game.js — turns ESPN game payloads into flat render-ready shapes.
// Views never touch ESPN's nesting; every branch here is unit-tested against
// recorded fixtures in tests/fixtures/.
//
// Three different team-reference conventions appear across these payloads, which is
// the main trap:
//   - scoreboard      inlines the full team object
//   - plays/drives    reference it as { $ref: '…/teams/6?lang=en' }
//   - situation       gives a BARE numeric id in `possession`
import { teamById, teamByAbbr, teamIdFromRef, logoPath, timeslot } from './config.js';

const hash = (c) => (c ? (String(c).startsWith('#') ? String(c) : `#${c}`) : null);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** '11:49' -> 709 seconds. */
export function clockToSeconds(display) {
  if (!display || typeof display !== 'string') return 0;
  const [m, s] = display.split(':').map(Number);
  if (Number.isNaN(m)) return 0;
  return m * 60 + (Number.isNaN(s) ? 0 : s);
}

function parseSide(competitor) {
  const t = competitor?.team ?? {};
  const abbr = t.abbreviation ?? '';
  const known = teamByAbbr(abbr);
  const record = (competitor.records ?? []).find((r) => r.type === 'total')?.summary ?? null;
  return {
    abbr,
    teamId: num(t.id),
    name: t.shortDisplayName ?? known?.name ?? abbr,
    fullName: t.displayName ?? known?.fullName ?? abbr,
    record,
    score: num(competitor.score) ?? 0,
    // ESPN ships colours as bare hex without a leading #. Fall back to the local table
    // only when the payload omits them.
    primary: hash(t.color) ?? known?.primary ?? null,
    alt: hash(t.alternateColor) ?? known?.alt ?? null,
    logo: logoPath(abbr),
    winner: competitor.winner === true,
  };
}

function parseGame(event) {
  const c = event.competitions?.[0] ?? {};
  const status = c.status ?? {};
  const sit = c.situation ?? null;
  const competitors = c.competitors ?? [];
  const home = competitors.find((x) => x.homeAway === 'home');
  const away = competitors.find((x) => x.homeAway === 'away');

  // situation.possession is a bare numeric team id, unlike the $refs elsewhere.
  const possTeam = sit?.possession ? teamById(sit.possession) : null;

  return {
    id: String(event.id),
    state: status.type?.state ?? 'pre',
    completed: status.type?.completed === true,
    statusDetail: status.type?.detail ?? null,
    startsAt: event.date ?? null,
    timeslot: event.date ? timeslot(event.date) : null,
    shortName: event.shortName ?? null,
    venue: c.venue?.fullName ?? null,
    broadcast: c.broadcast ?? null,
    period: num(status.period),
    clock: status.displayClock ?? null,
    possessionAbbr: possTeam?.abbr ?? null,
    down: num(sit?.down),
    distance: num(sit?.distance),
    yardLine: num(sit?.yardLine),
    downDistanceText: sit?.downDistanceText ?? null,
    redZone: sit?.isRedZone === true,
    lastPlay: sit?.lastPlay?.text ?? null,
    home: home ? parseSide(home) : null,
    away: away ? parseSide(away) : null,
  };
}

export function parseScoreboard(json) {
  const events = json?.events ?? [];
  return {
    season: num(json?.season?.year),
    seasonType: num(json?.season?.type),
    week: num(json?.week?.number),
    // A game missing a competitor would render as half a scorebug, so drop it.
    games: events.map(parseGame).filter((g) => g.home && g.away),
  };
}

export function parsePlays(json) {
  const items = json?.items ?? [];
  return items
    .map((p) => {
      const start = p.start ?? {};
      return {
        id: String(p.id),
        seq: Number(p.sequenceNumber ?? 0),
        period: num(p.period?.number),
        clock: p.clock?.displayValue ?? null,
        clockSeconds: clockToSeconds(p.clock?.displayValue),
        text: p.text ?? p.shortText ?? '',
        typeText: p.type?.text ?? null,
        teamAbbr: teamById(teamIdFromRef(p.team))?.abbr ?? null,
        scoring: p.scoringPlay === true,
        scoreValue: num(p.scoreValue) ?? 0,
        isTurnover: p.isTurnover === true,
        isPenalty: p.isPenalty === true,
        down: num(start.down),
        distance: num(start.distance),
        yardLine: num(start.yardLine),
        downDistanceText: start.downDistanceText ?? null,
        awayScore: num(p.awayScore) ?? 0,
        homeScore: num(p.homeScore) ?? 0,
        yards: num(p.statYardage) ?? 0,
      };
    })
    .sort((a, b) => b.seq - a.seq); // newest first — the feed reads top-down
}

export function parseDrives(json) {
  const items = json?.items ?? [];
  return items.map((d) => ({
    id: String(d.id),
    teamAbbr: teamById(teamIdFromRef(d.team))?.abbr ?? null,
    result: d.result ?? null,
    resultText: d.displayResult ?? d.shortDisplayResult ?? null,
    description: d.description ?? null,
    yards: num(d.yards) ?? 0,
    plays: num(d.offensivePlays) ?? 0,
    timeElapsed: d.timeElapsed?.displayValue ?? null,
    startText: d.start?.text ?? null,
    endText: d.end?.text ?? null,
    startPeriod: num(d.start?.period?.number),
    scoring: d.isScore === true,
  }));
}

export function parseProbabilities(json) {
  const items = json?.items ?? [];
  return items
    .map((w) => ({
      seq: Number(w.sequenceNumber ?? 0),
      // Rounded to one decimal at parse time: these render directly, and raw ESPN
      // values carry float artefacts (0.32399999999999995).
      homePct: Math.round((Number(w.homeWinPercentage) || 0) * 1000) / 10,
      awayPct: Math.round((Number(w.awayWinPercentage) || 0) * 1000) / 10,
      tiePct: Math.round((Number(w.tiePercentage) || 0) * 1000) / 10,
      secondsLeft: num(w.secondsLeft),
    }))
    .sort((a, b) => a.seq - b.seq); // oldest first — plotted left to right
}
