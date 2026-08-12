// core/nfl-state.js — what season and week is it.
//
// ⚠️ THIS IS ALL THAT REMAINS OF THE SLEEPER MIRROR, and it is not part of it. The
// Fantasy tab — a read-only view of a league living on Sleeper — was removed on
// 2026-08-12 now that the native League engine is shipped and running. Fifteen
// files went; this one survived because the hub's SEASON does not belong to that
// feature and never did.
//
// `core/app.js` sets `app.season`, `app.seasonType` and `app.week` from here, and
// they are load-bearing well outside fantasy: the standings tab refuses to draw a
// playoff picture when `seasonType === 'pre'`, the leaders tab labels last
// season's finals as final, and the header prints the week. Delete this and the
// hub silently loses all of it — nothing throws, the surfaces just start lying
// again, which is the exact defect two earlier sessions were spent fixing.
//
// It lives on Sleeper's state endpoint because that endpoint is authoritative,
// tiny, unauthenticated and needs no key. ⚠️ THE NATIVE ENGINE DEPENDS ON THE SAME
// HOST ANYWAY — `server/ops-scoring.js` pulls live NFL stat lines from
// `api.sleeper.app` on every scoring pass — so removing this would not remove
// Sleeper as a dependency, it would only remove the hub's ability to say what week
// it is.
import { getJson } from './http.js';

const API = 'https://api.sleeper.app/v1';

export const stateUrl = () => `${API}/state/nfl`;

export function parseState(json) {
  if (!json) return null;
  const type = json.season_type ?? null;
  return {
    week: num(json.week) ?? 1,
    displayWeek: num(json.display_week) ?? num(json.week) ?? 1,
    season: num(json.season),
    seasonType: type,
    isPreseason: type === 'pre',
    isRegular: type === 'regular',
    seasonStart: json.season_start_date ?? null,
  };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const fetchState = async () => parseState(await getJson(stateUrl()));
