// core/config.js — canonical team table + league constants.
//
// ESPN ids are NOT contiguous: they run 1-30 plus 33 and 34. There is no 31 or 32.
// ESPN abbreviates Washington as WSH (not WAS), and uses JAX / LAR / LAC.
// Colours are ESPN's own values, transcribed from the /teams payload on 2026-08-07.

export const TEAMS = {
  ARI: { id: 22, city: 'Arizona',      name: 'Cardinals',   conf: 'NFC', div: 'West',  primary: '#a40227', alt: '#ffffff' },
  ATL: { id:  1, city: 'Atlanta',      name: 'Falcons',     conf: 'NFC', div: 'South', primary: '#a71930', alt: '#000000' },
  BAL: { id: 33, city: 'Baltimore',    name: 'Ravens',      conf: 'AFC', div: 'North', primary: '#29126f', alt: '#000000' },
  BUF: { id:  2, city: 'Buffalo',      name: 'Bills',       conf: 'AFC', div: 'East',  primary: '#00338d', alt: '#d50a0a' },
  CAR: { id: 29, city: 'Carolina',     name: 'Panthers',    conf: 'NFC', div: 'South', primary: '#0085ca', alt: '#000000' },
  CHI: { id:  3, city: 'Chicago',      name: 'Bears',       conf: 'NFC', div: 'North', primary: '#0b1c3a', alt: '#e64100' },
  CIN: { id:  4, city: 'Cincinnati',   name: 'Bengals',     conf: 'AFC', div: 'North', primary: '#fb4f14', alt: '#000000' },
  CLE: { id:  5, city: 'Cleveland',    name: 'Browns',      conf: 'AFC', div: 'North', primary: '#472a08', alt: '#ff3c00' },
  DAL: { id:  6, city: 'Dallas',       name: 'Cowboys',     conf: 'NFC', div: 'East',  primary: '#002a5c', alt: '#b0b7bc' },
  DEN: { id:  7, city: 'Denver',       name: 'Broncos',     conf: 'AFC', div: 'West',  primary: '#0a2343', alt: '#fc4c02' },
  DET: { id:  8, city: 'Detroit',      name: 'Lions',       conf: 'NFC', div: 'North', primary: '#0076b6', alt: '#bbbbbb' },
  GB:  { id:  9, city: 'Green Bay',    name: 'Packers',     conf: 'NFC', div: 'North', primary: '#204e32', alt: '#ffb612' },
  HOU: { id: 34, city: 'Houston',      name: 'Texans',      conf: 'AFC', div: 'South', primary: '#021018', alt: '#eb0028' },
  IND: { id: 11, city: 'Indianapolis', name: 'Colts',       conf: 'AFC', div: 'South', primary: '#003b75', alt: '#ffffff' },
  JAX: { id: 30, city: 'Jacksonville', name: 'Jaguars',     conf: 'AFC', div: 'South', primary: '#007487', alt: '#d7a22a' },
  KC:  { id: 12, city: 'Kansas City',  name: 'Chiefs',      conf: 'AFC', div: 'West',  primary: '#e31837', alt: '#ffb612' },
  LAC: { id: 24, city: 'Los Angeles',  name: 'Chargers',    conf: 'AFC', div: 'West',  primary: '#0080c6', alt: '#ffc20e' },
  LAR: { id: 14, city: 'Los Angeles',  name: 'Rams',        conf: 'NFC', div: 'West',  primary: '#003594', alt: '#ffd100' },
  LV:  { id: 13, city: 'Las Vegas',    name: 'Raiders',     conf: 'AFC', div: 'West',  primary: '#000000', alt: '#a5acaf' },
  MIA: { id: 15, city: 'Miami',        name: 'Dolphins',    conf: 'AFC', div: 'East',  primary: '#008e97', alt: '#fc4c02' },
  MIN: { id: 16, city: 'Minnesota',    name: 'Vikings',     conf: 'NFC', div: 'North', primary: '#4f2683', alt: '#ffc62f' },
  NE:  { id: 17, city: 'New England',  name: 'Patriots',    conf: 'AFC', div: 'East',  primary: '#002a5c', alt: '#c60c30' },
  NO:  { id: 18, city: 'New Orleans',  name: 'Saints',      conf: 'NFC', div: 'South', primary: '#d3bc8d', alt: '#000000' },
  NYG: { id: 19, city: 'New York',     name: 'Giants',      conf: 'NFC', div: 'East',  primary: '#003c7f', alt: '#c9243f' },
  NYJ: { id: 20, city: 'New York',     name: 'Jets',        conf: 'AFC', div: 'East',  primary: '#115740', alt: '#ffffff' },
  PHI: { id: 21, city: 'Philadelphia', name: 'Eagles',      conf: 'NFC', div: 'East',  primary: '#06424d', alt: '#000000' },
  PIT: { id: 23, city: 'Pittsburgh',   name: 'Steelers',    conf: 'AFC', div: 'North', primary: '#000000', alt: '#ffb612' },
  SEA: { id: 26, city: 'Seattle',      name: 'Seahawks',    conf: 'NFC', div: 'West',  primary: '#002a5c', alt: '#69be28' },
  SF:  { id: 25, city: 'San Francisco', name: '49ers',      conf: 'NFC', div: 'West',  primary: '#aa0000', alt: '#b3995d' },
  TB:  { id: 27, city: 'Tampa Bay',    name: 'Buccaneers',  conf: 'NFC', div: 'South', primary: '#bd1c36', alt: '#3e3a35' },
  TEN: { id: 10, city: 'Tennessee',    name: 'Titans',      conf: 'AFC', div: 'South', primary: '#4495d2', alt: '#001532' },
  WSH: { id: 28, city: 'Washington',   name: 'Commanders',  conf: 'NFC', div: 'East',  primary: '#5a1414', alt: '#ffb612' },
};

for (const [abbr, t] of Object.entries(TEAMS)) {
  t.abbr = abbr;
  t.fullName = `${t.city} ${t.name}`;
}

export const TEAM_BY_ID = Object.fromEntries(
  Object.values(TEAMS).map((t) => [t.id, t]),
);

/** Abbreviations other sources use for the same franchise. */
export const ABBR_ALIAS = {
  WAS: 'WSH', ARZ: 'ARI', JAC: 'JAX', LA: 'LAR', SD: 'LAC', OAK: 'LV', STL: 'LAR',
};

export const DIVISIONS = (() => {
  const out = {};
  for (const t of Object.values(TEAMS)) {
    const key = `${t.conf} ${t.div}`;
    (out[key] ||= []).push(t.abbr);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
})();

export function normalizeAbbr(abbr) {
  if (!abbr) return '';
  const up = String(abbr).toUpperCase();
  return ABBR_ALIAS[up] ?? up;
}

export function teamByAbbr(abbr) {
  return TEAMS[normalizeAbbr(abbr)] ?? null;
}

export function teamById(id) {
  return TEAM_BY_ID[Number(id)] ?? null;
}

/** ESPN sends team references as { $ref: '…/teams/6?lang=en' } in the plays, drives
 *  and probabilities payloads. The numeric id in the path is the only usable
 *  identifier, so pull it out. Accepts the bare url or the wrapped object, and
 *  returns null rather than throwing on anything else. */
export function teamIdFromRef(ref) {
  const url = typeof ref === 'string' ? ref : ref?.$ref;
  if (typeof url !== 'string') return null;
  const m = url.match(/\/teams\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Local asset path — deliberately NOT an espncdn url. There are only 32 logos and
 *  they repeat on every surface; the node image proxy allows 120 req/min per IP, so
 *  fetching them at runtime buys nothing and risks rate-limiting the whole plugin. */
// ⚠️ RELATIVE TO THIS PLUGIN'S DIRECTORY, not to the plugins root. These carried an
// `nfl-hub/` prefix until 2026-08-15, which worked only because every plugin shipped
// `<base href=".../plugins/">`. That tag was removed so a mirrored plugin would stop
// resolving assets against the publisher's host; the entry HTML's refs were rewritten at
// the time and these were missed, leaving a doubled path that 404s on every host — team
// logos rendered as empty boxes with no failing request that named the plugin.
export function logoPath(abbr) {
  return `assets/logos/${normalizeAbbr(abbr).toLowerCase()}.png`;
}

const ET = 'America/New_York';

/** Broadcast window name for a kickoff time, in US Eastern regardless of viewer tz.
 *
 *  The early-morning clauses matter: a Thursday 8:20pm ET kickoff is Friday 00:20Z,
 *  and Sunday/Monday night games likewise land on the following UTC day. Converting
 *  to ET first, then absorbing the spill, is what keeps them named correctly. */
export function timeslot(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: ET });
  const hour = Number(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: ET }));
  if (day === 'Thursday' || (day === 'Friday' && hour < 3)) return 'Thursday Night Football';
  if (day === 'Monday' || (day === 'Tuesday' && hour < 3)) return 'Monday Night Football';
  if (day === 'Sunday') {
    if (hour < 15) return 'Sunday · 1:00 PM ET';
    if (hour < 18) return 'Sunday · 4:25 PM ET';
    return 'Sunday Night Football';
  }
  if (day === 'Saturday') return 'Saturday';
  return day;
}

export const POLL_LIVE_MS = 20_000;
export const POLL_IDLE_MS = 300_000;
export const TARGET_FPS = 30;
