// views/player.js — the player page.
//
// Needs BOTH athlete endpoints, because neither alone is a player page: athletes/{id}
// carries the bio (jersey, height, weight, age, college) and athletes/{id}/overview
// carries stats, fantasy ranks and news with no athlete key at all.
import { chip, panel, stateMsg, esc, tile, errorPane} from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchAthlete, fetchAthleteBio } from '../core/espn-client.js';
import { parseAthlete, parseAthleteBio } from '../core/espn-league.js';
import { teamByAbbr, logoPath } from '../core/config.js';
import { teamColor, positionPill } from '../core/player-visuals.js';
import { imageUrl } from '../../plugin-sdk.js';

const state = { loading: true, error: null, athleteId: null, bio: null, overview: null };

export function statTable(splits) {
  const list = splits ?? [];
  if (!list.length) return '';
  const names = list[0].stats.map((x) => x.name);
  return '<table class="grid"><thead><tr><th>Split</th>'
    + names.map((n) => `<th>${esc(n)}</th>`).join('')
    + '</tr></thead><tbody>'
    + list.map((sp) => (
      `<tr><td>${esc(sp.label)}</td>`
      + sp.stats.map((x) => `<td class="num">${esc(x.value)}</td>`).join('')
      + '</tr>'
    )).join('')
    + '</tbody></table>';
}

export function renderPlayer(s = state) {
  if (s.loading) return stateMsg('Loading player…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load this player.');
  if (!s.bio) return stateMsg('Choose a player to see their page.');

  const b = s.bio;
  const team = b.teamAbbr ? teamByAbbr(b.teamAbbr) : null;

  let html = '<div style="padding:10px 20px 0">'
    + '<button class="badge" data-act="nav" data-view="leaders">← Leaders</button></div>';

  // ⚠️ THE PAGE KNEW HIS CLUB AND HIS POSITION AND USED NEITHER — both were already
  // on it as plain text. The band tints by CLUB and the pill carries the
  // categorical POSITION scale: the same two encodings the leaders board settled
  // on, for the same reason. You should know what somebody plays before you read
  // a word.
  const vitals = [b.jersey ? `#${b.jersey}` : null, b.height, b.weight,
    b.age ? `${b.age} yrs` : null, b.college].filter(Boolean).map(esc).join(' · ');
  html += `<div class="pl-band" style="--tc:${esc(teamColor(b.teamAbbr))}">`
    + '<div class="pl-band-in">'
      + (b.headshot
        ? `<img class="pl-shot" src="${esc(imageUrl(b.headshot))}" alt="" onerror="this.remove()">`
        : '')
      + '<div class="pl-id">'
        + `<div class="pl-name">${esc(b.name)}</div>`
        + '<div class="pl-meta">'
          + positionPill(b.position)
          + (team
            ? chip({ abbr: team.abbr, fullName: team.fullName, logo: logoPath(team.abbr) },
              { clickable: true, showRecord: false })
            : '')
          + (vitals ? `<span class="pl-vitals">${vitals}</span>` : '')
        + '</div>'
      + '</div>'
    + '</div></div>';

  const f = s.overview?.fantasy;
  if (f && (f.draftRank || f.positionRank || f.percentOwned)) {
    html += panel({
      title: 'Fantasy',
      body: `<div class="tiles">${
        tile('Draft rank', f.draftRank ?? '—')
        + tile('Position rank', f.positionRank ?? '—')
        + tile('% owned', f.percentOwned !== null ? `${f.percentOwned}%` : '—')
      }</div>`,
    });
  }

  const stats = statTable(s.overview?.seasonStats);
  if (stats) html += panel({ title: 'Season stats', flush: true, body: stats });

  const news = s.overview?.news ?? [];
  if (news.length) {
    html += panel({
      title: 'Player news',
      body: news.slice(0, 8).map((a) => (
        '<div style="padding:8px 0;border-bottom:1px solid var(--line)">'
        + (a.link
          ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer"`
            + ` style="color:inherit;text-decoration:none">${esc(a.headline)}</a>`
          : esc(a.headline))
        + '</div>'
      )).join(''),
    });
  }

  return html;
}

export function render() { return renderPlayer(state); }

export async function enter() {
  const { app } = await import('../core/app.js');
  app.onAction = (act, el) => {
    if (act === 'team') { app.teamAbbr = el.dataset.team; app.router.go('team'); }
  };

  const id = app.athleteId;
  if (!id) { state.loading = false; state.bio = null; app.router.refresh(); return; }
  if (state.athleteId !== id) {
    state.loading = true;
    state.athleteId = id;
    app.router.refresh();
  }

  // Both endpoints, degrading independently: bio alone is still a usable page.
  const [bioRaw, ovRaw] = await Promise.all([
    cache.get(urls.athleteBio(id), () => fetchAthleteBio(id), TTL.ATHLETE,
      { staleOnError: true }).catch(() => null),
    cache.get(urls.athlete(id), () => fetchAthlete(id), TTL.ATHLETE,
      { staleOnError: true }).catch(() => null),
  ]);

  state.bio = bioRaw ? parseAthleteBio(bioRaw) : null;
  state.overview = ovRaw ? parseAthlete(ovRaw) : null;
  state.error = state.bio ? null : 'no data';
  state.loading = false;
  app.router.refresh();
}
