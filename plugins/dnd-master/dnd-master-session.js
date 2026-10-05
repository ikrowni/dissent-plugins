// dnd-master-session.js — Start session / End session at the top of Run (spec 2026-10-03 §6). Decisions live in
// dnd-master-session-rules.js; this file draws the bar and the two windows and writes the campaign records.
import { EV } from './dnd-hub-event-types.js?v=20261013v';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { publishTo } from './lk-bus.js';
import { esc, genId } from '../plugin-sdk.js';
import { appendLogEntry } from './dnd-master-logs.js';
import { levellingByXp } from './dnd-master-levels.js';
import { defaultSceneId, defaultMusic, sessionMusic, recapTitle, newSession, currentSession, draftRecap } from './dnd-master-session-rules.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
export function setSessionState(state) { _state = state; renderSessionBar(); }

const field = 'width:100%;box-sizing:border-box;margin:3px 0 8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 6px;font-size:11px;font-family:inherit';
const label = t => `<div style="font-size:10px;color:var(--muted)">${t}</div>`;

export function renderSessionBar() {
  const el = document.getElementById('session-bar');
  const c = _state.dmCampaign;
  if (!el || !c) return;
  const open = currentSession(c);
  el.innerHTML = open
    ? `<span style="flex:1;font-size:10px;color:var(--muted)">Session running since ${esc(new Date(open.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>` +
      '<button class="btn btn-ghost" onclick="openEndSession()">End session</button>'
    : '<button class="btn btn-gold" style="flex:1" onclick="openStartSession()">Start session</button>';
  // Growing your hero: one button for the table's levelling rule.
  el.innerHTML += levellingByXp()
    ? '<button class="btn btn-ghost" onclick="giveXpParty()">Give XP</button>'
    : '<button class="btn btn-ghost" onclick="levelUpParty()">Level up the party</button>';
}

function _window(inner) {
  closeSessionWindow();
  const w = document.createElement('div');
  w.id = 'session-window';
  w.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:12px';
  w.innerHTML = `<div style="background:var(--bg,#111);border:1px solid var(--border);border-radius:8px;padding:12px;width:100%;max-width:340px">${inner}</div>`;
  document.body.appendChild(w);
}
export function closeSessionWindow() { document.getElementById('session-window')?.remove(); }

function _musicOptions(scene, selected) {
  return [['scene', 'Scene soundtrack', !!scene?.soundtrackFileId], ['ambience', 'Ambience (wind and drip)', true], ['off', 'No music', true]]
    .filter(([, , ok]) => ok)
    .map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('');
}

export function openStartSession() {
  const c = _state.dmCampaign;
  if (!c) return;
  const sid = defaultSceneId(c);
  const scenes = Object.values(c.scenes || {});
  _window(
    '<div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">Start session</div>' +
    label('Last time…') + `<textarea id="session-recap" rows="5" style="${field}">${esc(c.storyRecap || '')}</textarea>` +
    label('Scene') + `<select id="session-scene" style="${field}" onchange="onSessionSceneChange()"><option value="">Keep the current map</option>` +
      scenes.map(s => `<option value="${esc(s.id)}"${s.id === sid ? ' selected' : ''}>${esc(s.name || 'Scene')}</option>`).join('') + '</select>' +
    label('Music') + `<select id="session-music" style="${field}">${_musicOptions(c.scenes?.[sid], defaultMusic(c.scenes?.[sid]))}</select>` +
    '<div style="display:flex;gap:6px"><button class="btn btn-ghost" style="flex:1" onclick="closeSessionWindow()">Cancel</button>' +
    '<button id="session-start-btn" class="btn btn-gold" style="flex:1" onclick="startSessionNow()">Start</button></div>');
}

export function onSessionSceneChange() {
  const scene = _state.dmCampaign?.scenes?.[document.getElementById('session-scene')?.value];
  document.getElementById('session-music').innerHTML = _musicOptions(scene, defaultMusic(scene));
}

export async function startSessionNow() {
  const c = _state.dmCampaign;
  const { dmCampaignId, serverData, userId } = _state;
  if (!c) return;
  const recap = document.getElementById('session-recap')?.value.trim() || '';
  const sceneId = document.getElementById('session-scene')?.value || '';
  const scene = c.scenes?.[sceneId] || null;
  const music = sessionMusic(scene, document.getElementById('session-music')?.value || 'ambience');
  const now = new Date();
  let journalId = null;
  if (recap) {
    // The recap stays readable in the party journal (players' Notes tab).
    journalId = genId();
    c.journals = { ...(c.journals || {}), [journalId]: { id: journalId, title: recapTitle(now), content: recap,
      visibility: 'player', createdAt: now.toISOString(), updatedAt: now.toISOString() } };
  }
  c.storyRecap = recap;
  if (sceneId) c.lastSceneId = sceneId;
  const session = newSession(c, { id: genId(), sceneId, journalId, now });
  c.sessions = [...(c.sessions || []), session];
  serverData.campaigns[dmCampaignId] = c;
  await saveHubDmCompanion(serverData);
  closeSessionWindow();
  renderSessionBar();
  await publishTo(['hub', 'player'], EV.SESSION_START, { campaignId: dmCampaignId, sessionId: session.id,
    sceneId: sceneId || null, mapId: scene?.mapId || null, videoFileId: scene?.videoFileId || null,
    recap, music, fromUserId: userId });
  appendLogEntry({ type: 'session-start', message: 'Session started' + (scene ? ` — ${scene.name}` : '') }).catch(() => {});
}

export function openEndSession() {
  const c = _state.dmCampaign;
  const open = currentSession(c);
  if (!open) return;
  const draft = draftRecap({ log: c.log || [], since: open.startedAt, startLevels: open.startLevels,
    summaries: c.characterSummaries || {}, sceneName: c.scenes?.[open.sceneId]?.name || '' });
  _window(
    '<div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">End session</div>' +
    label('Next time\'s "Last time…" (edit freely)') + `<textarea id="session-next-recap" rows="6" style="${field}">${esc(draft)}</textarea>` +
    '<div style="display:flex;gap:6px"><button class="btn btn-ghost" style="flex:1" onclick="closeSessionWindow()">Cancel</button>' +
    '<button id="session-end-btn" class="btn btn-gold" style="flex:1" onclick="saveEndSession()">End session</button></div>');
}

export async function saveEndSession() {
  const c = _state.dmCampaign;
  const open = currentSession(c);
  if (!open) return;
  open.endedAt = new Date().toISOString();
  c.storyRecap = document.getElementById('session-next-recap')?.value.trim() || '';
  _state.serverData.campaigns[_state.dmCampaignId] = c;
  await saveHubDmCompanion(_state.serverData);
  closeSessionWindow();
  renderSessionBar();
  appendLogEntry({ type: 'session-end', message: 'Session ended' }).catch(() => {});
}
