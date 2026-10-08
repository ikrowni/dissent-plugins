// dnd-hub-schedule.js — "Next session" on the map screen: the 📅 button, players ticking the times they can make, and
// the posts to the campaign's channel (owner, 2026-10-07; rules in lk-schedule.js).
//
// The DM asks and picks in the sidebar (dnd-master-schedule.js), which sends `schedule:set`. The DM's own Hub posts
// the question and the chosen time to the channel (the Hub holds `bot:post`; the sidebar does not). Each player's
// answer is their own server key (lk-schedule.js voteKey) plus a `schedule:vote` event for screens already open;
// the DM's Hub hands that on to the DM sidebar (a player has no consent to publish to dnd-master).
// The reminder a day before is posted by whichever screen of the table is open then: the first to claim it.
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261015t';
import { esc, request, storageGet, storageSet, localPublish } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { icon } from './lk-icons.js';
import { cleanNextSession, cleanVote, voteKey, tally, chosenOption, reminderDue, untilText, dmTimeText, postText } from './lk-schedule.js';

let _votes = {};            // userId → vote, for the open question
let _votesFor = null;       // `${campaignId}:${sessionId}` the cache belongs to
let _tick = 0;

const campaign = () => serverData?.campaigns?.[MAP.campaignId];
const question = () => cleanNextSession(campaign()?.nextSession);
const myName = () => campaign()?.characters?.[userId]?.name || campaign()?.characterSummaries?.[userId]?.name || 'A player';
const localTime = at => new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Read every member's answer for the open question (one read each; only when the question changes). */
async function loadVotes(ns) {
  const key = `${MAP.campaignId}:${ns?.id}`;
  if (!ns || _votesFor === key) return;
  _votesFor = key; _votes = {};
  const c = campaign();
  const who = [...new Set([...(c?.members || []), c?.dmUserId].filter(Boolean))];
  await Promise.all(who.map(async uid => {
    const v = await storageGet(voteKey(MAP.campaignId, ns.id, uid), 'server');
    if (v) _votes[uid] = v;
  }));
}

/** The toolbar button's words: nothing asked, a question waiting for me, or how long until the chosen time. */
export function syncScheduleButton() {
  const b = document.getElementById('btn-next-session');
  if (!b) return;
  const ns = question(), chosen = chosenOption(ns);
  const waiting = ns && !chosen && ns.options.length && !MAP.isDM && !(_votes[userId]?.picks || []).length;
  b.innerHTML = `${icon('calendar-clock')}${chosen ? esc(untilText(chosen.at)) : 'Next'}` + (waiting ? '<span class="lk-dot" aria-label="The DM asked when you can play"></span>' : '');
  b.title = chosen ? `Next session: ${localTime(chosen.at)}` : ns?.options.length ? 'The DM asked when you can play next' : 'Next session: not set yet';
}

export async function toggleSchedulePanel() {
  const old = document.getElementById('schedule-panel');
  if (old) { old.remove(); return; }
  const el = document.createElement('div');
  el.id = 'schedule-panel'; el.className = 'lk-pop';
  // Below the whole toolbar: it wraps to two rows on a narrow screen, and a panel at a fixed height covered the X.
  el.style.top = `${(document.getElementById('map-toolbar')?.offsetHeight || 40) + 6}px`;
  document.getElementById('map-root')?.appendChild(el);
  await loadVotes(question());
  drawPanel();
}

function drawPanel() {
  const el = document.getElementById('schedule-panel');
  if (!el) return;
  const ns = question(), chosen = chosenOption(ns);
  let body;
  if (!ns || !ns.options.length) {
    body = `<div class="lk-pop-note">${MAP.isDM ? 'Ask the table in the DM sidebar: Run → Next session.' : 'The DM hasn\'t set the next session yet.'}</div>`;
  } else if (chosen) {
    body = `<div style="font-size:15px;color:var(--lk-text)">${esc(localTime(chosen.at))}</div>
      <div class="lk-pop-note">${esc(untilText(chosen.at))} · your own time</div>`;
  } else {
    const mine = new Set(_votes[userId]?.picks || []);
    body = tally(ns, _votes).map(o => `<label class="lk-pop-row" style="cursor:${MAP.isDM ? 'default' : 'pointer'}">
        ${MAP.isDM ? '' : `<input type="checkbox" style="flex:0" ${mine.has(o.id) ? 'checked' : ''} onchange="scheduleTick('${esc(o.id)}', this.checked)">`}
        <span style="flex:1;color:var(--lk-text)">${o.best ? '★ ' : ''}${esc(localTime(o.at))}</span>
        <span title="${esc(o.names.join(', '))}">${o.names.length ? esc(o.names.join(', ')) : '—'}</span></label>`).join('') +
      `<div class="lk-pop-note">${MAP.isDM ? 'Pick one in the DM sidebar: Run → Next session.' : 'Tick every time you can make. Times are in your own time zone.'}</div>`;
  }
  el.innerHTML = `<div class="lk-pop-title">Next session</div>${ns?.note ? `<div class="lk-pop-note" style="margin:0 0 6px">${esc(ns.note)}</div>` : ''}${body}`;
}

/** A player ticks or unticks a time: saved as their own answer, and told to every open screen and the DM sidebar. */
export async function scheduleTick(optionId, on) {
  const ns = question();
  if (!ns || MAP.isDM) return;
  const picks = new Set(_votes[userId]?.picks || []);
  if (on) picks.add(optionId); else picks.delete(optionId);
  const vote = cleanVote({ sessionId: ns.id, picks: [...picks], name: myName() }, ns);
  _votes[userId] = vote;
  drawPanel(); syncScheduleButton();
  await storageSet(voteKey(MAP.campaignId, ns.id, userId), vote, 'server');
  await publishTo([], 'schedule:vote', { type: 'schedule:vote', campaignId: MAP.campaignId, ...vote, fromUserId: userId });
}

/** `schedule:set` (DM only, dnd-hub-events.js) and `schedule:vote`. */
export async function handleScheduleEvent(p) {
  if (p.campaignId !== MAP.campaignId) return;
  const c = campaign();
  if (p.type === 'schedule:set') {
    if (c) c.nextSession = p.nextSession || null;
    const ns = question();
    if (!ns || _votesFor !== `${MAP.campaignId}:${ns.id}`) { _votesFor = null; if (document.getElementById('schedule-panel')) await loadVotes(ns); }
    // The DM's own Hub posts what the sidebar asked it to (the sidebar has no bot:post).
    if (p.post && MAP.isDM && p.fromUserId === userId && ns) {
      const chosen = chosenOption(ns);
      const text = p.post === 'chosen' && chosen ? postText('chosen', { campaignName: c?.name, when: dmTimeText(chosen.at) })
        : p.post === 'ask' ? postText('ask', { campaignName: c?.name, count: ns.options.length }) : null;
      if (text) await request('bot:post', { content: text }).catch(e => console.warn('[schedule] post failed', e));
    }
  } else if (p.type === 'schedule:vote') {
    const v = cleanVote(p, question());
    if (v && p.fromUserId) _votes[p.fromUserId] = v;
    // A player cannot reach the DM sidebar themselves (no consent to that plugin): the DM's Hub passes it on.
    if (v && MAP.isDM) localPublish('dnd-master', 'schedule:vote', p);
  }
  drawPanel(); syncScheduleButton();
}

/**
 * The day-before reminder. Any screen of the table may post it, so the first to see it due claims it in storage,
 * waits, and posts only if its claim is still the one stored (two screens at once: one post, at worst rarely two).
 */
async function remindIfDue() {
  const ns = question(), c = campaign();
  if (!ns || !c) return;
  const key = `sched-reminded-${MAP.campaignId}`;
  const now = Date.now();
  const last = await storageGet(key, 'server');
  if (!reminderDue(ns, now, last?.id ?? null)) return;
  const claim = { id: ns.id, by: userId, at: now, n: Math.random() };
  await storageSet(key, claim, 'server');
  await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
  const kept = await storageGet(key, 'server');
  if (kept?.n !== claim.n) return;
  await request('bot:post', { content: postText('reminder', { campaignName: c.name, when: dmTimeText(chosenOption(ns).at) }) })
    .catch(e => console.warn('[schedule] reminder failed', e));
}

/** The map screen opened: draw the button, read the answers, and check the reminder now and every 10 minutes. */
export function startSchedule() {
  clearInterval(_tick);
  _votesFor = null;
  loadVotes(question()).then(syncScheduleButton);
  syncScheduleButton();
  remindIfDue().catch(() => {});
  _tick = setInterval(() => { syncScheduleButton(); remindIfDue().catch(() => {}); }, 10 * 60000);
}
