// views/coop.js — invite a Dissent friend to co-op sharing, and accept or decline invites.
//
// Used by Deck (page and overlay panel) and Community. The rules live in the node (friends:link) and in
// core/party.js; this only shows links and turns clicks into invite / respond / remove.

import { h, clear } from '../core/dom.js';
import { friends, local } from '../core/host.js';
import { cachedLinks, refreshLinks, inviteToParty, sharingNow } from '../core/party.js';

const WHAT = 'their deck, relics, HP and map while they host a co-op run, and the run when it ends';

/**
 * A self-updating block. `showInvite` (a boolean, or a function read on each paint): offer "Invite a friend" —
 * Deck does while this computer's run is co-op.
 * `manage`: list accepted links with Remove (Community). Returns `{ el, refresh, destroy }`.
 */
export function mountCoop(ctx, { showInvite = true, manage = false, compact = false } = {}) {
  const el = h('div', { class: `coop${compact ? ' compact' : ''}`, dataset: { part: 'coop' } });
  const state = { links: [], picking: false, friends: null, error: null, confirm: null, sharing: [], auto: null };
  let alive = true;

  const act = (label, part, onclick) => h('button', { type: 'button', class: 'chip', dataset: { act: part }, onclick }, label);

  async function run(fn) {
    state.error = null;
    try { await fn(); } catch (e) { state.error = String(e?.message ?? e).replace(/^.*?failed: /, ''); }
    state.links = await refreshLinks({ friends, local });
    paint();
  }

  function paint() {
    if (!alive) return;
    const received = state.links.filter((l) => l.direction === 'received' && l.status === 'pending');
    const sent = state.links.filter((l) => l.direction === 'sent' && l.status === 'pending');
    const accepted = state.links.filter((l) => l.status === 'accepted');
    const linked = new Set(state.links.map((l) => l.peer?.handle));
    const rows = [];

    for (const l of received) {
      rows.push(h('div', { class: 'coop-invite', dataset: { invite: l.id } },
        h('span', {}, `${l.peer.name} invites you to co-op sharing: you see ${WHAT}, and they see yours.`),
        act('Accept', 'accept', () => run(() => friends.respond(l.id, true))),
        act('Decline', 'decline', () => run(() => friends.respond(l.id, false)))));
    }
    if (state.sharing.length) {
      rows.push(h('p', { class: 'sub', dataset: { part: 'sharing-now' } }, `Sharing this run with ${state.sharing.join(', ')} — you're playing together.`));
    }
    for (const l of sent) rows.push(h('p', { class: 'sub', dataset: { sent: l.id } }, `Invite sent to ${l.peer.name} — waiting for them to accept.`));
    if (accepted.length) {
      if (manage || !state.sharing.length) {
        rows.push(h('p', { class: 'sub', dataset: { part: 'linked' } }, `Co-op sharing with ${accepted.map((l) => l.peer.name).join(', ')}.`));
      }
      if (manage) {
        for (const l of accepted) {
          const sure = state.confirm === l.id;
          rows.push(act(sure ? `Really stop sharing with ${l.peer.name}?` : `Stop sharing with ${l.peer.name}`, 'remove',
            () => (sure ? run(() => friends.remove(l.id)).then(() => { state.confirm = null; }) : (state.confirm = l.id, paint()))));
        }
      }
    }

    if (manage && state.auto !== null) {
      rows.push(h('label', { class: 'switch', dataset: { part: 'auto' } },
        h('input', { type: 'checkbox', checked: state.auto, dataset: { act: 'auto' }, onchange: (e) => run(async () => {
          await friends.setAuto(e.target.checked);
          state.auto = e.target.checked;
        }) }),
        ' Share automatically with friends I play co-op with (matched by our connected Steam accounts)'));
    }
    if ((typeof showInvite === 'function' ? showInvite() : showInvite) && !state.sharing.length) {
      if (!state.picking) {
        rows.push(act('Invite a friend', 'invite', async () => {
          state.picking = true;
          state.friends = null;
          paint();
          try { state.friends = (await friends.list()).friends; } catch (e) { state.friends = []; state.error = String(e?.message ?? e); }
          paint();
        }));
      } else if (state.friends === null) {
        rows.push(h('p', { class: 'sub' }, 'Finding friends…'));
      } else {
        const choices = state.friends.filter((f) => !linked.has(f.handle));
        rows.push(h('div', { class: 'coop-pick', dataset: { part: 'pick' } },
          choices.length
            ? choices.map((f) => act(`Invite ${f.name}`, 'invite-friend', () => run(async () => {
              await inviteToParty({ friends, local, handle: f.handle });
              state.picking = false;
            })))
            : h('span', { class: 'sub' }, state.friends.length
              ? 'Everyone who can be invited already is.'
              : 'None of your Dissent friends has STS2 Companion with friend connections allowed yet.'),
          act('Cancel', 'cancel', () => { state.picking = false; paint(); })));
      }
    }
    if (state.error) rows.push(h('p', { class: 'sub', dataset: { part: 'coop-error' } }, `Could not do that: ${state.error}`));
    clear(el).append(...rows);
    el.hidden = rows.length === 0;
  }

  async function refresh({ fromNode = false } = {}) {
    state.links = fromNode ? await refreshLinks({ friends, local }) : await cachedLinks(local);
    state.sharing = await sharingNow(local);
    if (manage && state.auto === null) {
      try { state.auto = (await friends.list()).auto !== false; } catch { state.auto = null; }
    }
    paint();
  }

  const off = ctx.onSavesChanged?.((ev) => { if (ev?.coop) refresh(); });
  refresh({ fromNode: true });
  return { el, refresh, destroy() { alive = false; off?.(); } };
}
