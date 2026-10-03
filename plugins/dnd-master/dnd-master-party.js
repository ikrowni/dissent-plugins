// dnd-master-party.js — Party at a glance for the DM: one live row per hero at the top of Run. The rows and their
// HTML come from lk-party.js; this file keeps the state and opens the existing player editor on a click.
import { dmRows, dmPartyHtml } from './lk-party.js';
import { isRepeat } from './lk-bus.js';

let _state = { dmCampaign: null, dmCampaignId: null };

export function setPartyState(state) { _state = state; renderPartyPanel(); }

/** Always drawn (D4); renderNav decides whether it shows. */
export function renderPartyPanel() {
  const el = document.getElementById('party-panel');
  const c = _state.dmCampaign;
  if (!el || !c) return;
  el.innerHTML = '<div style="font-size:10px;font-weight:700;color:var(--gold);letter-spacing:.05em;margin-bottom:2px">PARTY</div>' +
    dmPartyHtml(dmRows(c.characterSummaries || {}, c.members || []));
}

/** A hero's summary changed (party:update, handed over by the DM's Hub). A player can only update their own row. */
export function applyPartyUpdate(p) {
  const c = _state.dmCampaign;
  if (!c || p.campaignId !== _state.dmCampaignId || isRepeat(p) || p.fromUserId !== p.userId || !p.summary) return;
  c.characterSummaries = { ...(c.characterSummaries || {}), [p.userId]: p.summary };
  renderPartyPanel();
}
