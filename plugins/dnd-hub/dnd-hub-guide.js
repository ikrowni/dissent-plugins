// dnd-hub-guide.js — the "Set the scene" guide.
//
// A new DM used to land on a black canvas reading "No map loaded"; players saw "Waiting for DM…" in grey.
// The DM now gets a short checklist (centre card until there is a map, then a small dismissible corner
// card until walls and players exist); players get a lantern-lit waiting card. Pure parts are exported
// for tests; renderGuide() owns the DOM.
import { icon } from './lk-icons.js';

const STEPS = [
  { id: 'campaign', label: 'Campaign created' },
  { id: 'map',      label: 'Upload a map' },
  { id: 'walls',    label: 'Draw walls and doors' },
  { id: 'players',  label: 'Players join from the lobby' },
];

export function setupChecklist(campaign, mapData) {
  const done = {
    campaign: true,
    map: !!mapData?.fileId,
    walls: ((mapData?.walls || []).length + Object.keys(mapData?.doors || {}).length) > 0,
    players: (campaign?.members || []).length > 0,
  };
  return STEPS.map(s => ({ ...s, done: done[s.id] }));
}

export function guideMode({ isDM, list, dismissed }) {
  const hasMap = list.find(s => s.id === 'map').done;
  if (!isDM) return hasMap ? 'none' : 'waiting';
  if (!hasMap) return 'center';
  if (list.every(s => s.done) || dismissed) return 'none';
  return 'corner';
}

const _dismissed = new Set(); // campaign ids whose corner card was closed this session

/** (Re)draw the guide for the open campaign. Call after map load and after walls, doors or members change. */
export function renderGuide({ campaignId, campaign, mapData, isDM }) {
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  document.getElementById('lk-guide')?.remove();
  const list = setupChecklist(campaign, mapData);
  const mode = guideMode({ isDM, list, dismissed: _dismissed.has(campaignId) });
  if (mode === 'none') return;

  const el = document.createElement('div');
  el.id = 'lk-guide';
  el.className = `lk-guide lk-guide-${mode}`;
  if (mode === 'waiting') {
    el.innerHTML = `<div class="lk-guide-card lk-dialog">
      <div class="lk-glow" style="line-height:0">${icon('lantern', { size: 40 })}</div>
      <div class="lk-title" style="font-size:15px;margin-top:8px">The DM is setting the scene…</div>
      <div class="lk-guide-sub">The map appears here as soon as it's ready.</div></div>`;
  } else {
    const next = list.find(s => !s.done)?.id;
    el.innerHTML = `<div class="lk-guide-card lk-dialog">
      ${mode === 'corner' ? `<button class="lk-guide-x" aria-label="Hide this guide" onclick="window._lkDismissGuide()">${icon('x', { size: 14 })}</button>` : ''}
      <div class="lk-title" style="font-size:${mode === 'center' ? 16 : 13}px;margin-bottom:8px">Set the scene</div>
      <ul class="lk-guide-list">${list.map(s => `
        <li class="${s.done ? 'done' : ''}${s.id === next ? ' next' : ''}">
          ${icon(s.done ? 'circle-check' : 'circle', { size: 15 })}<span>${s.label}</span></li>`).join('')}
      </ul>
      ${next === 'map' ? `<button class="btn btn-gold" onclick="triggerMapUpload()">${icon('upload')}Upload map</button>
        <div class="lk-guide-sub">An image or a looping video. A Universal VTT file (Import) brings its walls and doors too.</div>` : ''}
      ${next === 'walls' ? `<button class="btn btn-ghost btn-sm" onclick="toggleEditMode();setTool('wall')">${icon('brick-wall')}Draw walls</button>` : ''}
      ${next === 'players' ? `<div class="lk-guide-sub">Players open this channel, choose <b>Join a game</b> and pick your campaign.</div>` : ''}
    </div>`;
  }
  wrap.appendChild(el);
  window._lkDismissGuide = () => { _dismissed.add(campaignId); el.remove(); };
}
