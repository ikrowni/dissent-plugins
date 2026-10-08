// dnd-hub-safety.js — the table's safety tools on the map screen: the Safety panel (lines and veils) and the X.
//
// Each player's own picks are private: kept in their USER-scope storage and sent to the DM's Hub (`safety:set`). The
// DM's Hub keeps who asked for what in the campaign's DM-only part (`safetyByUser`, lk-secrets.js) and shares only the
// combined, nameless list (`campaign.safety`, `safety:table`). The DM may be away when a player sets theirs, so a
// player's Hub sends them again each time the map opens. The X (`safety:x`) shows on every screen without a name.
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261015u';
import { esc, storageGet, storageSet } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015u';
import { TOPICS, cleanPicks, combine, X_COOLDOWN_MS } from './lk-safety.js';

let _mine = { topics: {}, custom: [] };
let _lastX = 0;

const campaign = () => serverData?.campaigns?.[MAP.campaignId];
const myKey = () => `safety-${MAP.campaignId}`;
const send = (type, data) => publishTo([], type, { type, campaignId: MAP.campaignId, fromUserId: userId, ...data });

export function toggleSafetyPanel() {
  const old = document.getElementById('safety-panel');
  if (old) { old.remove(); return; }
  const el = document.createElement('div');
  el.id = 'safety-panel'; el.className = 'lk-pop lk-safety';
  // Below the whole toolbar: it wraps to two rows on a narrow screen, and a panel at a fixed height covered the X.
  el.style.top = `${(document.getElementById('map-toolbar')?.offsetHeight || 40) + 6}px`;
  document.getElementById('map-root')?.appendChild(el);
  drawPanel();
}

function tableHtml() {
  const t = campaign()?.safety || { lines: [], veils: [] };
  const list = (items, empty) => items.length ? `<div class="lk-chips">${items.map(x => `<span class="lk-chip">${esc(x)}</span>`).join('')}</div>`
    : `<div class="lk-pop-note" style="margin-top:2px">${empty}</div>`;
  return `<div class="lk-pop-row" style="margin-top:0"><b style="color:var(--lk-text)">Lines</b>&nbsp;— never in this game</div>${list(t.lines, 'None yet.')}
    <div class="lk-pop-row"><b style="color:var(--lk-text)">Veils</b>&nbsp;— may happen, off-screen</div>${list(t.veils, 'None yet.')}`;
}

/** The table's list changed: redraw only that part, never what the player is typing (it wiped the "Something else" box). */
function drawTable() {
  const el = document.getElementById('safety-table');
  if (el) el.innerHTML = tableHtml();
}

function drawPanel() {
  const el = document.getElementById('safety-panel');
  if (!el) return;
  const table = `<div id="safety-table">${tableHtml()}</div>`;
  const mine = MAP.isDM ? '<div class="lk-pop-note">Players set theirs here privately. You see the list, never who asked for what.</div>'
    : `<div class="lk-pop-title" style="margin-top:12px">Yours (only you see these)</div>
      <div class="lk-safety-grid">${TOPICS.map(tp => {
        const v = _mine.topics[tp.id] || 'ok';
        return `<span>${esc(tp.name)}</span><select data-topic="${tp.id}" aria-label="${esc(tp.name)}">
          ${[['ok', 'Fine'], ['veil', 'Veil'], ['line', 'Line']].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      }).join('')}</div>
      ${_mine.custom.map((c, i) => `<div class="lk-pop-row"><span style="flex:1;color:var(--lk-text)">${esc(c.text)}</span><span>${c.kind === 'line' ? 'Line' : 'Veil'}</span>
        <button class="lk-x" data-del="${i}" aria-label="Remove">✕</button></div>`).join('')}
      ${_mine.custom.length < 5 ? `<div class="lk-pop-row"><input id="safety-own" maxlength="60" placeholder="Something else…" style="flex:1">
        <select id="safety-own-kind"><option value="veil">Veil</option><option value="line">Line</option></select>
        <button class="lk-dice-try" id="safety-add" style="margin:0">Add</button></div>` : ''}`;
  el.innerHTML = `<div class="lk-pop-title">Table safety</div>${table}${mine}
    <div class="lk-pop-note">${MAP.isDM ? 'A player can tap ✋ X at any time: move the scene on, no questions asked.' : 'Tap ✋ X on the toolbar at any time to move the scene on. Nobody sees who tapped it.'}</div>`;
  el.onchange = e => {
    const id = e.target.dataset?.topic;
    if (!id) return;
    if (e.target.value === 'ok') delete _mine.topics[id]; else _mine.topics[id] = e.target.value;
    saveMine();
  };
  el.onclick = e => {
    if (e.target.id === 'safety-add') {
      const text = document.getElementById('safety-own')?.value.trim();
      if (!text) return;
      _mine.custom.push({ text, kind: document.getElementById('safety-own-kind')?.value });
      saveMine(); drawPanel();
    } else if (e.target.dataset?.del != null) {
      _mine.custom.splice(Number(e.target.dataset.del), 1);
      saveMine(); drawPanel();
    }
  };
}

// One at a time, numbered: three quick changes sent at once arrived out of order and an older set won (playtest).
let _chain = Promise.resolve(), _seq = 0;
function saveMine() {
  _mine = cleanPicks(_mine);
  const picks = _mine, seq = Date.now() * 1000 + (++_seq % 1000);
  _chain = _chain.then(async () => {
    await storageSet(myKey(), picks, 'user');
    await send('safety:set', { picks, seq });
  }).catch(() => {});
  return _chain;
}

/** The ✋ X: no reason, no name, on every screen. */
export async function tapX() {
  if (MAP.isDM || Date.now() - _lastX < X_COOLDOWN_MS) return;
  _lastX = Date.now();
  showX();
  await send('safety:x', {});
}

function showX() {
  document.getElementById('lk-safety-x')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-safety-x'; el.setAttribute('role', 'alert');
  el.innerHTML = `<b>✋ X</b><span>${MAP.isDM ? 'Someone tapped X. Move the scene on — no questions asked.' : 'Someone tapped X. The scene moves on.'}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

/** `safety:set` (DM's Hub keeps it), `safety:table` (DM only: the combined list), `safety:x`. */
export async function handleSafetyEvent(p) {
  if (p.campaignId !== MAP.campaignId) return;
  const c = campaign();
  if (p.type === 'safety:x') { if (p.fromUserId !== userId) showX(); return; }
  if (p.type === 'safety:table') { if (c) c.safety = p.safety; drawTable(); return; }
  if (p.type === 'safety:set' && MAP.isDM && c && p.fromUserId && (c.members || []).includes(p.fromUserId)) {
    const seq = Number(p.seq) || 0;
    if (seq && seq <= (c.safetyByUser?.[p.fromUserId]?.seq || 0)) return; // older than what we have
    c.safetyByUser = { ...(c.safetyByUser || {}), [p.fromUserId]: { ...cleanPicks(p.picks), seq } };
    const next = combine(c.safetyByUser);
    if (JSON.stringify(next) === JSON.stringify(c.safety || { lines: [], veils: [] })) return;
    c.safety = next;
    drawTable();
    await send('safety:table', { safety: next });
    await saveHubDm(serverData);
  }
}

/** The map screen opened: read my picks, and send them again (the DM's Hub may have missed them). */
export async function startSafety() {
  if (MAP.isDM) return;
  _mine = cleanPicks(await storageGet(myKey(), 'user'));
  if (Object.keys(_mine.topics).length || _mine.custom.length) await saveMine();
}
