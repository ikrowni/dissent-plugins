// views/league-identity.js — naming and picturing a franchise.
//
// Two cards, both rendered under the League tab beside co-management, because
// they answer the same kind of question: not how the team plays, but who it is.
//
// ⚠️ OWNER-ONLY, MIRRORING THE MODULE. `requireTeamOwner` admits the owner and a
// commissioner and refuses a co-owner — a co-owner sets lineups, and renaming the
// franchise is not playing it. The gate here is only so the UI does not offer an
// action that will be refused; the module is what enforces it.
//
// ⚠️ WIRED IN THE SAME CHANGE AS THE OPS. `league:settings` shipped working and
// unreachable for months because nothing called it, and `setQueue` did the same
// to the draft queue. A capability with no caller has never been checked.

import { esc, panel } from '../core/ui.js';
import { renameTeam, setTeamIdentity, setLeagueBanner } from '../core/league-api.js';
import { checkTeamName, MAX_TEAM_NAME } from '../core/league/team-identity.js';
import {
  uploadImage, discard, resolve, contextFor, ACCEPT_ATTR, specHint,
  IMAGE_SPEC, assertUploadable,
} from '../core/team-images.js';
import { openCropper } from './crop-dialog.js';
import { teamAvatar, banner } from '../core/team-visuals.js';
import { describe } from './league-home.js';

const state = {
  busy: null,   // which control is working: 'name' | 'avatar' | 'banner' | 'league'
  err: null,
  notice: null,
};

export function reset() {
  Object.assign(state, { busy: null, err: null, notice: null });
}

/** The team this user OWNS in this league, or null. Co-owning is not owning. */
export function ownedTeam(league) {
  const me = league?.me;
  if (!me) return null;
  return Object.values(league?.teams ?? {}).find((t) => t.ownerId === me) ?? null;
}

/**
 * The team identity card.
 *
 * ⚠️ RENDERS TO NOTHING for somebody with no team of their own, rather than to an
 * explanatory panel. The League tab already tells a team-less visitor to join,
 * and a second empty card under it repeats that in a way that reads as broken.
 */
export function renderTeamCard(league) {
  const team = ownedTeam(league);
  if (!team) return '';

  return panel({
    title: 'Your team',
    right: `<span class="muted">${esc(team.id)}</span>`,
    body: `
      ${state.err ? `<p class="imp-bad">${esc(state.err)}</p>` : ''}
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      ${banner(team.bannerFileId, { className: 'tm-banner-team' })}
      <div class="tm-id">
        ${teamAvatar(team, { size: 56 })}
        <form data-act="team-rename-form" class="tm-rename">
          <label>Team name
            <input name="name" value="${esc(team.name ?? '')}"
                   maxlength="${MAX_TEAM_NAME}" required>
          </label>
          <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
            ${state.busy === 'name' ? 'Saving…' : 'Rename'}
          </button>
        </form>
      </div>
      ${pickerRow('Avatar', 'avatar', team.avatarFileId, 'avatar')}
      ${pickerRow('Banner', 'banner', team.bannerFileId, 'teamBanner')}`,
  });
}

/**
 * The league banner card, for a commissioner.
 *
 * ⚠️ BESIDE the league name, not inside the settings form. The settings form
 * posts a rules object the module normalises and validates; a banner is not a
 * rule, and folding it in would make every settings save carry an image field.
 */
export function renderLeagueCard(league) {
  if (!league?.isCommissioner) return '';
  return panel({
    title: 'League banner',
    right: '<span class="muted">commissioner</span>',
    body: `
      ${banner(league.bannerFileId, { className: 'tm-banner-league' })}
      ${pickerRow('League banner', 'league', league.bannerFileId, 'leagueBanner')}
      <p class="tiny">Shown at the top of the League tab for everybody in
        ${esc(league.settings?.name ?? 'this league')}.</p>`,
  });
}

/**
 * One picker.
 *
 * ⚠️ THE `<input type="file">` IS THE CONTROL, styled as a button by its label.
 * A hidden input driven by a click handler is the more common pattern and it is
 * worse here: the hub re-renders the whole view on every refresh, so the element
 * a stored handler was bound to is gone by the time the file dialog returns.
 * Delegation survives that; a bound handler does not.
 *
 * ⚠️ `data-pick`, DELIBERATELY NOT `data-act`. core/app.js delegates BOTH `click`
 * and `input` to `onAction`, and a file input fires `input` as well as `change` —
 * so a `data-act` here would deliver the same chosen file twice and upload it
 * twice. The section owns a `change` listener for these, exactly as it already
 * owns one for `submit`.
 */
function pickerRow(label, kind, currentFileId, specKey) {
  const working = state.busy === kind;
  return `<div class="tm-pick">
    <span class="tm-pick-label">${esc(label)}</span>
    <label class="btn tm-pick-btn ${state.busy ? 'is-disabled' : ''}">
      ${working ? 'Uploading…' : currentFileId ? 'Replace' : 'Upload'}
      <input type="file" accept="${esc(ACCEPT_ATTR)}" data-pick="${esc(kind)}"
             ${state.busy ? 'disabled' : ''}>
    </label>
    ${currentFileId
    ? `<button class="btn" data-act="tm-clear" data-kind="${esc(kind)}"
               ${state.busy ? 'disabled' : ''}>Remove</button>`
    : ''}
    <span class="tm-pick-hint">${esc(specHint(specKey))}</span>
  </div>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Rename.
 *
 * ⚠️ CHECKED LOCALLY WITH THE MODULE'S OWN RULE before the round trip — the same
 * `core/league/team-identity.js` the module imports, so the two cannot disagree
 * about what a legal name is. This is not the enforcement; it is what stops an
 * obviously-empty field costing a request.
 */
export async function rename(app, ctx, form) {
  const check = checkTeamName(form?.name);
  if (!check.ok) {
    state.err = check.error;
    app?.router?.refresh();
    return;
  }
  await run(app, ctx, 'name', async (league) => {
    const team = ownedTeam(league);
    if (!team) throw new Error('you do not own a team in this league');
    await renameTeam(ctx.leagueId, team.id, check.name);
    return `Renamed to “${check.name}”.`;
  });
}

/**
 * Upload a picture and point the record at it.
 *
 * ⚠️ THE OLD FILE IS DISCARDED ONLY AFTER THE NEW ID IS STORED, and never in a
 * way that can fail the save. Deleting first would leave a team with no picture
 * if the module then refused; and only the UPLOADER may delete, so a commissioner
 * replacing somebody else's avatar gets a 403 that must stay invisible.
 */
const SPEC_OF = { avatar: 'avatar', banner: 'teamBanner', league: 'leagueBanner' };

export async function pick(app, ctx, kind, file) {
  // ⚠️ THE CROP RUNS BEFORE `run()`, OUTSIDE THE BUSY STATE. The dialog waits on a
  // person, not on the network — sitting there with every control disabled and
  // "Uploading…" on the button, for as long as they take to frame the picture,
  // would be a lie about what is happening. Nothing is spent until they accept.
  // ⚠️ THE RAW FILE IS CHECKED BEFORE THE CROPPER TOUCHES IT. The cropper decodes
  // the whole image into memory, so a 200 MB photo hangs the tab — and since the
  // crop re-encodes to a small WebP, a check afterwards would never see the
  // original's size at all.
  try {
    assertUploadable(file);
  } catch (err) {
    state.err = describe(err);
    app?.router?.refresh();
    return;
  }

  const spec = IMAGE_SPEC[SPEC_OF[kind]];
  const chosen = await openCropper(file, spec, {
    title: kind === 'avatar' ? 'Adjust avatar' : 'Adjust banner',
  });
  // Cancelled. Not an error, and not a state worth reporting.
  if (!chosen) return;

  await run(app, ctx, kind, async (league) => {
    const team = ownedTeam(league);
    if (kind !== 'league' && !team) throw new Error('you do not own a team in this league');

    const context = kind === 'league'
      ? contextFor.league(ctx.leagueId)
      : contextFor.team(ctx.leagueId, team.id);
    // ⚠️ The cropper returns a Blob, which has no `name`. `uploadImage` reads one
    // and the node stores it as the filename, so a bare blob would land as
    // "undefined". Named from the kind, and the extension follows the real type.
    const named = asNamedFile(chosen, `${kind}.${(chosen.type.split('/')[1] || 'webp')}`);
    const fileId = await uploadImage(named, { context });

    const previous = kind === 'league' ? league.bannerFileId
      : kind === 'avatar' ? team.avatarFileId : team.bannerFileId;

    if (kind === 'league') await setLeagueBanner(ctx.leagueId, fileId);
    else if (kind === 'avatar') await setTeamIdentity(ctx.leagueId, team.id, { avatarFileId: fileId });
    else await setTeamIdentity(ctx.leagueId, team.id, { bannerFileId: fileId });

    if (previous && previous !== fileId) await discard(previous);
    await resolve([fileId]);
    return 'Uploaded.';
  });
}

/** Clear a picture. '' is the module's deliberate "remove this" value. */
export async function clear(app, ctx, kind) {
  await run(app, ctx, kind, async (league) => {
    const team = ownedTeam(league);
    if (kind !== 'league' && !team) throw new Error('you do not own a team in this league');

    const previous = kind === 'league' ? league.bannerFileId
      : kind === 'avatar' ? team.avatarFileId : team.bannerFileId;

    if (kind === 'league') await setLeagueBanner(ctx.leagueId, '');
    else if (kind === 'avatar') await setTeamIdentity(ctx.leagueId, team.id, { avatarFileId: '' });
    else await setTeamIdentity(ctx.leagueId, team.id, { bannerFileId: '' });

    if (previous) await discard(previous);
    return 'Removed.';
  });
}

/**
 * The shared busy/error/reload wrapper.
 *
 * ⚠️ A REFUSAL LANDS IN THIS CARD, never in the league's `error`, which blanks
 * the whole tab. The same separation `saveSettings` makes with `setErr`: the form
 * you are standing in has to still be on screen when it tells you no.
 */
async function run(app, ctx, kind, fn) {
  state.busy = kind;
  state.err = null;
  state.notice = null;
  app?.router?.refresh();
  try {
    state.notice = await fn(ctx.league());
    await ctx.reload();
  } catch (err) {
    state.err = describe(err);
  } finally {
    state.busy = null;
    app?.router?.refresh();
  }
}

export { state as _state };

/**
 * Give a Blob a name without assuming `File` is constructible.
 *
 * ⚠️ A CROPPED RESULT IS A Blob, NOT A File. `new File([blob], name)` works in
 * every browser this ships to, but the plugin also has to survive being imported
 * by a unit test in node, where File may be absent — so the constructor is tried
 * and a plain shim is used when it is not there. The shim carries exactly the
 * four fields `uploadImage` reads.
 */
function asNamedFile(blob, name) {
  try {
    return new File([blob], name, { type: blob.type });
  } catch {
    return {
      name,
      type: blob.type,
      size: blob.size,
      arrayBuffer: () => blob.arrayBuffer(),
    };
  }
}
