// dnd-hub-stage.js — the roleplay stage on every screen: the NPCs in a talking scene as big portraits along the foot
// of the map, the one speaking lit, and their words as subtitles (owner, 2026-10-07; rules in lk-stage.js).
//
// The DM brings an NPC on from its token's menu (dnd-hub-tokens.js → bringOnStage), clicks a portrait to choose who
// speaks (or Narrator), and types. Each change sends the whole stage (`stage:set`, DM only); it is also kept in the
// campaign (`campaign.stage`) so a screen that opens mid-scene shows it.
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261015x';
import { publishTo } from './lk-bus.js';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015x';
import { cleanStage, addToStage, removeFromStage, speak } from './lk-stage.js';
import { medal } from './dnd-hub-tavern.js?v=20261015x';
import { talkFor } from './dnd-hub-tavern-npcs.js?v=20261015x';

let _stage = null, _shownLine = null, _typer = 0, _saveTimer = 0, _drawn = '';
const campaign = () => serverData?.campaigns?.[MAP.campaignId];

/** The DM changes the stage: draw it here, send it to every screen, keep it in the campaign (saved shortly). */
async function setStage(next) {
  _stage = cleanStage(next);
  await draw();
  await publishTo([], 'stage:set', { type: 'stage:set', campaignId: MAP.campaignId, stage: _stage, fromUserId: userId });
  const c = campaign();
  if (!c) return;
  c.stage = _stage;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveHubDm(serverData).catch(() => {}), 2000);
}

/** From an NPC token's menu (DM): who they are comes from the DM's NPC, else the token. */
export function bringOnStage(token) {
  if (!MAP.isDM || !token) return;
  const host = token.npcActorId ? talkFor(token.npcActorId) : null;
  const id = token.npcActorId || token.id;
  return setStage(addToStage(_stage, { id, name: host?.name || token.name, portraitFileId: host?.portraitFileId || token.portraitFileId || null }));
}

export const isOnStage = token => !!_stage?.npcs.some(n => n.id === (token?.npcActorId || token?.id));

/** `stage:set` from the DM (privileged in dnd-hub-events.js). */
export async function handleStageEvent(p) {
  if (p.campaignId !== MAP.campaignId || p.type !== 'stage:set' || p.fromUserId === userId) return;
  _stage = cleanStage(p.stage);
  const c = campaign();
  if (c) c.stage = _stage;
  await draw();
}

/** The map screen opened: show a scene already under way. */
export function startStage() {
  _stage = cleanStage(campaign()?.stage);
  _shownLine = null; _drawn = '';
  draw();
}

async function draw() {
  const wrap = document.getElementById('map-canvas-wrap');
  let el = document.getElementById('lk-stage');
  if (!_stage || !wrap) { el?.remove(); _drawn = ''; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'lk-stage'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Talking scene');
    el.innerHTML = '<div class="st-cast"></div><div class="st-say" aria-live="polite"><b></b><span></span></div>' +
      (MAP.isDM ? '<form class="st-dm"><select aria-label="Who speaks"></select><input maxlength="500" placeholder="Say something… (Enter)" aria-label="Line">' +
        '<button type="submit" class="tv-btn primary">Say</button><button type="button" class="tv-btn st-end" title="End the scene for everyone">End</button></form>' : '');
    wrap.appendChild(el);
    if (MAP.isDM) wireDm(el);
  }
  // The cast: redrawn only when it changes (portraits load from storage).
  const castKey = JSON.stringify(_stage.npcs);
  if (castKey !== _drawn) {
    _drawn = castKey;
    const cast = el.querySelector('.st-cast');
    cast.innerHTML = '';
    for (const n of _stage.npcs) {
      const b = document.createElement(MAP.isDM ? 'button' : 'div');
      b.className = 'st-npc'; b.dataset.id = n.id;
      b.appendChild(await medal(n));
      b.appendChild(Object.assign(document.createElement('span'), { className: 'st-name', textContent: n.name }));
      if (MAP.isDM) {
        b.type = 'button'; b.title = `${n.name} speaks (right-click: off the stage)`;
        b.onclick = () => setStage({ ..._stage, speaker: n.id });
        b.oncontextmenu = e => { e.preventDefault(); setStage(removeFromStage(_stage, n.id)); };
      }
      cast.appendChild(b);
    }
    const sel = el.querySelector('.st-dm select');
    if (sel) sel.innerHTML = _stage.npcs.map(n => `<option value="${n.id}"></option>`).join('') + '<option value="">Narrator</option>';
    sel?.querySelectorAll('option').forEach((o, i) => { if (i < _stage.npcs.length) o.textContent = _stage.npcs[i].name; });
  }
  const lit = _stage.line ? _stage.line.speaker : _stage.speaker; // narration lights nobody
  el.querySelectorAll('.st-npc').forEach(b => b.classList.toggle('speaking', b.dataset.id === lit));
  const sel = el.querySelector('.st-dm select');
  if (sel && document.activeElement !== sel) sel.value = _stage.speaker ?? '';
  // The line types itself out, once per line.
  const l = _stage.line;
  if (l && l.n !== _shownLine) {
    _shownLine = l.n;
    const say = el.querySelector('.st-say');
    say.classList.toggle('narration', !l.speaker);
    say.querySelector('b').textContent = l.speaker ? l.name : '';
    const span = say.querySelector('span');
    clearInterval(_typer);
    let i = 0;
    _typer = setInterval(() => { i += 2; span.textContent = l.text.slice(0, i); if (i >= l.text.length) clearInterval(_typer); }, 18);
  } else if (!l) { el.querySelector('.st-say b').textContent = ''; el.querySelector('.st-say span').textContent = ''; }
}

function wireDm(el) {
  const form = el.querySelector('.st-dm'), input = form.querySelector('input'), sel = form.querySelector('select');
  form.onsubmit = e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    setStage(speak(_stage, sel.value || null, text));
  };
  sel.onchange = () => { if (sel.value) setStage({ ..._stage, speaker: sel.value }); };
  form.querySelector('.st-end').onclick = () => setStage(null);
}
