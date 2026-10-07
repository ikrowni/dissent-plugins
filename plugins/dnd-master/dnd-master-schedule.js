// dnd-master-schedule.js — "Next session" for the DM: offer up to four times, see who can make each, pick one
// (owner, 2026-10-07; rules in lk-schedule.js, the players' side in dnd-hub-schedule.js).
//
// The question is saved in the campaign and sent as `schedule:set`; the DM's Hub posts it to the channel. Players'
// answers are read from their own keys when the window opens and arrive live as `schedule:vote`.
import { esc, genId, storageGetCompanion } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { publishTo } from './lk-bus.js';
import { cleanNextSession, cleanVote, voteKey, tally, chosenOption, untilText, MAX_OPTIONS } from './lk-schedule.js';

let _state = null;
let _votes = {};
export function setScheduleState(s) { _state = s; }

/** The DM's question, for the playtests. */
export const currentNextSession = () => cleanNextSession(_state?.dmCampaign?.nextSession);

const field = 'width:100%;box-sizing:border-box;margin:3px 0 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 6px;font-size:11px;font-family:inherit';
const when = at => new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// A datetime-local value for a time a week from now at 19:00, the usual evening slot.
function nextWeekValue(offsetDays = 7) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  d.setHours(19, 0, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:00`;
}

function _window(inner) {
  closeScheduleWindow();
  const w = document.createElement('div');
  w.id = 'schedule-window';
  w.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow:auto';
  w.innerHTML = `<div style="background:var(--bg,#111);border:1px solid var(--border);border-radius:8px;padding:12px;width:100%;max-width:340px">` +
    `<div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">Next session</div>${inner}</div>`;
  document.body.appendChild(w);
}
export function closeScheduleWindow() { document.getElementById('schedule-window')?.remove(); }

async function loadVotes(ns) {
  _votes = {};
  const c = _state.dmCampaign;
  await Promise.all((c.members || []).map(async uid => {
    const v = await storageGetCompanion('dnd-hub', voteKey(_state.dmCampaignId, ns.id, uid), 'server');
    if (v) _votes[uid] = v;
  }));
}

export async function openSchedule() {
  const ns = currentNextSession();
  if (!ns || !ns.options.length) return drawAsk();
  _window('<div style="font-size:11px;color:var(--muted)">Reading the answers…</div>');
  await loadVotes(ns);
  drawAnswers();
}

function drawAsk() {
  _window('<div style="font-size:10px;color:var(--muted);margin-bottom:6px">Offer up to four times. Players tick the ones they can make in the map\'s 📅 Next button; the table\'s channel is told.</div>' +
    Array.from({ length: MAX_OPTIONS }, (_, i) =>
      `<input type="datetime-local" class="sched-opt" style="${field}" value="${i < 2 ? nextWeekValue(7 + i) : ''}">`).join('') +
    `<input id="sched-note" maxlength="200" placeholder="A note (optional): 'We start Chapter 3'" style="${field}">` +
    '<div style="display:flex;gap:6px"><button class="btn btn-ghost" style="flex:1" onclick="closeScheduleWindow()">Cancel</button>' +
    '<button id="sched-ask" class="btn btn-gold" style="flex:1" onclick="askSchedule()">Ask the table</button></div>');
}

function drawAnswers() {
  const ns = currentNextSession();
  if (!ns) return drawAsk();
  const chosen = chosenOption(ns);
  const rows = tally(ns, _votes).map(o =>
    `<div class="sched-row" data-opt="${esc(o.id)}" style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--border)">` +
      `<div style="flex:1"><div style="font-size:11px;font-weight:600">${o.best ? '★ ' : ''}${esc(when(o.at))}</div>` +
      `<div style="font-size:10px;color:var(--muted)">${o.names.length ? `${o.names.length}: ${esc(o.names.join(', '))}` : 'Nobody yet'}</div></div>` +
      (o.id === chosen?.id ? '<span style="font-size:10px;color:var(--gold)">Chosen</span>'
        : `<button class="btn btn-ghost" style="font-size:10px" onclick="pickSchedule('${esc(o.id)}')">Pick</button>`) + '</div>').join('');
  const players = (_state.dmCampaign.members || []).length, answered = Object.keys(_votes).length;
  _window((chosen ? `<div style="font-size:11px;margin-bottom:6px">Next session ${esc(untilText(chosen.at))}: <b>${esc(when(chosen.at))}</b></div>` : '') +
    `<div style="font-size:10px;color:var(--muted);margin-bottom:4px">${answered} of ${players} player${players === 1 ? '' : 's'} answered.</div>` + rows +
    '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-ghost" style="flex:1" onclick="newScheduleQuestion()">Ask again</button>' +
    '<button class="btn btn-ghost" style="flex:1" onclick="closeScheduleWindow()">Close</button></div>');
}

async function saveAndSend(ns, post) {
  const c = _state.dmCampaign;
  c.nextSession = ns;
  _state.serverData.campaigns[_state.dmCampaignId].nextSession = ns;
  await saveHubDmCompanion(_state.serverData);
  await publishTo(['hub'], 'schedule:set', { type: 'schedule:set', campaignId: _state.dmCampaignId, nextSession: ns, post,
    fromUserId: _state.userId });
}

export async function askSchedule() {
  const options = [...document.querySelectorAll('#schedule-window .sched-opt')]
    .map(i => i.value && new Date(i.value).getTime()).filter(Boolean).map(at => ({ id: genId(), at }));
  const ns = cleanNextSession({ id: genId(), options, note: document.getElementById('sched-note')?.value, askedAt: Date.now() });
  if (!ns?.options.length) { alert('Add at least one time that is still to come.'); return; }
  const btn = document.getElementById('sched-ask');
  if (btn) { btn.disabled = true; btn.textContent = 'Asking…'; }
  // With one time there is nothing to ask: it is the next session.
  if (ns.options.length === 1) ns.chosenId = ns.options[0].id;
  await saveAndSend(ns, ns.chosenId ? 'chosen' : 'ask');
  _votes = {};
  drawAnswers();
}

export async function pickSchedule(optionId) {
  const ns = currentNextSession();
  if (!ns?.options.some(o => o.id === optionId)) return;
  await saveAndSend({ ...ns, chosenId: optionId }, 'chosen');
  drawAnswers();
}

export function newScheduleQuestion() { drawAsk(); }

/** A player answered (from their Hub): shown at once if the window is open. */
export function onScheduleVote(p) {
  if (p.campaignId !== _state?.dmCampaignId || !p.fromUserId) return;
  const v = cleanVote(p, currentNextSession());
  if (!v) return;
  _votes[p.fromUserId] = v;
  if (document.querySelector('#schedule-window .sched-row')) drawAnswers();
}
