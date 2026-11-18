// core/team-visuals.js — how a FANTASY team is pictured, everywhere.
//
// The sibling of player-visuals.js and it holds the same line: one module, so the
// standings, a matchup side, the trade board and the draft board all picture a
// team identically. A manager who looks like two different franchises across two
// tabs is a bug nobody files and everybody notices.
//
// ⚠️ `managerColor()` STAYS AS THE FALLBACK — it is not being replaced. Most
// teams will have no avatar for most of a season, and the colour is what makes a
// standings table readable at a glance. An avatar is an UPGRADE on the colour,
// not a substitute: the accent border stays either way, and the monogram is
// tinted with the same hue. This is the rule player-visuals.js already applies to
// headshots versus monograms, and the reason both render at the same size.

import { esc } from './ui.js';
import { managerColor, initials } from './player-visuals.js';
import { urlFor } from './team-images.js';

/**
 * A team's mark: its avatar if it has one and the URL has resolved, its monogram
 * otherwise.
 *
 * ⚠️ BOTH RENDER IN THE SAME BOX. A list of teams must not reflow as avatars
 * resolve — the monogram is not a spinner waiting to be replaced, it is the final
 * state for every team that never uploads anything.
 *
 * ⚠️ `onerror="this.remove()"` LEAVES THE MONOGRAM STANDING. The signed URL
 * expires, and a team whose banner 403s mid-session must degrade to its initials
 * rather than to a broken-image glyph.
 */
export function teamAvatar(team, { size = 26 } = {}) {
  const color = managerColor(team?.id);
  // ⚠️ `font-size` IS PART OF THE BOX, and leaving it out shipped an illegible
  // monogram to production. The ring is sized in px from `size`, but `.tm-mono`
  // is sized in `em` — so without a font-size here the initials inherit the
  // SURROUNDING text instead, and a 26px ring in a 13px table row rendered them
  // at about 5px. They were in the DOM, correct and escaped, and every unit test
  // passed; jsdom has no layout, so nothing could see it. Found by driving the
  // live app and cropping the screenshot.
  const box = `width:${size}px;height:${size}px;font-size:${size}px`;
  const url = urlFor(team?.avatarFileId);
  const mono = `<span class="tm-mono">${esc(initials(team?.name ?? ''))}</span>`;
  if (url) {
    return `<span class="tm-avatar" style="${box};--tm:${esc(color)}">`
      + `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">${mono}</span>`;
  }
  return `<span class="tm-avatar tm-avatar-mono" style="${box};--tm:${esc(color)}">${mono}</span>`;
}

/**
 * The mark plus the name, which is the unit almost every surface actually wants.
 *
 * `extra` is trusted HTML the caller has already escaped — the "you" tag and the
 * bye note both arrive that way from their existing call sites.
 */
export function teamMark(team, { size = 26, extra = '' } = {}) {
  return `<span class="tm-mark">${teamAvatar(team, { size })}`
    + `<span class="tm-name">${esc(team?.name ?? team?.id ?? '—')}</span>${extra}</span>`;
}

/**
 * A banner strip, or nothing at all.
 *
 * ⚠️ ABSENT RATHER THAN EMPTY. A placeholder band above every league that has not
 * set one would be a permanent grey scar on the most-visited pane in the section;
 * a league with no banner should look like a league, not like a league with a
 * missing banner. The upload control lives in the identity card, which is where
 * somebody goes when they want one.
 */
export function banner(fileId, { className = '' } = {}) {
  const url = urlFor(fileId);
  if (!url) return '';
  return `<div class="tm-banner ${esc(className)}">`
    + `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.closest('.tm-banner')?.remove()"></div>`;
}

/**
 * Every file id a league's rendering needs, for one `resolve()` call.
 *
 * ⚠️ ONE PLACE THAT KNOWS WHERE IMAGES LIVE ON A LEAGUE PAYLOAD. A view that
 * assembled its own list would silently stop resolving anything a later field
 * added — the picture would just quietly never appear.
 */
export function imageIdsOf(league) {
  const ids = [league?.bannerFileId];
  for (const team of Object.values(league?.teams ?? {})) {
    ids.push(team?.avatarFileId, team?.bannerFileId);
  }
  return ids.filter(Boolean).map(String);
}
