// dnd-master-prep.js — the Prep tab (Run): the session prep board, eight short steps (owner, 2026-10-07; rules in
// lk-prep.js). DM-only: `campaign.prep` is a secret (lk-secrets.js), so players never read it.
//
// NPCs and treasure can be picked from the DM's own NPCs and Items, so the board points at things that exist.
import { esc } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { PREP_STEPS, LISTS, cleanPrep, addLine, toggleLine, removeLine, clearDone, prepCounts } from './lk-prep.js';

let _state = null;
let _saveTimer = 0;
export function setPrepState(s) { _state = s; }

/** The board as this tab holds it (for the playtests). */
export const currentPrep = () => cleanPrep(_state?.dmCampaign?.prep);

function save() {
  _state.dmCampaign.prep = currentPrep();
  _state.serverData.campaigns[_state.dmCampaignId].prep = _state.dmCampaign.prep;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveHubDmCompanion(_state.serverData).catch(() => {}), 500);
}

const set = p => { _state.dmCampaign.prep = p; save(); };

function heroes() {
  const c = _state.dmCampaign, sums = c.characterSummaries || {};
  const rows = (c.members || []).map(uid => sums[uid]).filter(Boolean);
  if (!rows.length) return '<div class="lk-empty" style="text-align:left">No heroes yet.</div>';
  return rows.map(s => `<div style="font-size:11px">• <b>${esc(s.name || 'A hero')}</b> <span style="color:var(--muted)">` +
    `${esc([s.race, s.class || s.className].filter(Boolean).join(' '))}${s.level ? ' · level ' + s.level : ''}</span></div>`).join('');
}

function picker(list) {
  const c = _state.dmCampaign;
  const things = list === 'npcs' ? Object.values(c.customActors || {}).filter(a => a.type === 'npc').map(a => ['actor:' + a.id, a.name])
    : list === 'treasure' ? Object.values(c.items || {}).map(i => ['item:' + i.id, i.name])
      : list === 'monsters' ? Object.values(c.customActors || {}).filter(a => a.type === 'monster').map(a => ['actor:' + a.id, a.name]) : [];
  if (!things.length) return '';
  return `<select data-pick="${list}" style="max-width:110px"><option value="">+ from yours…</option>` +
    things.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('') + '</select>';
}

export function renderPrepTab() {
  const el = document.getElementById('tab-prep');
  if (!el || !_state?.dmCampaign) return;
  const p = currentPrep(), n = prepCounts(p);
  el.innerHTML = '<div class="lk-sec">SESSION PREP</div>' +
    '<div style="font-size:10px;color:var(--muted);margin-bottom:8px">Eight short steps. Only you see this.' +
      (n.clues ? ` Clues found: <b style="color:var(--gold)">${n.found} of ${n.clues}</b>.` : '') + '</div>' +
    PREP_STEPS.map((s, i) => {
      const head = `<div class="prep-head"><span class="prep-n">${i + 1}</span><b>${esc(s.name)}</b></div><div class="prep-hint">${esc(s.hint)}</div>`;
      if (s.id === 'heroes') return `<div class="prep-step">${head}${heroes()}</div>`;
      if (s.id === 'start') return `<div class="prep-step">${head}<textarea id="prep-start" rows="2" maxlength="500" placeholder="The bridge is burning as they arrive…">${esc(p.start)}</textarea></div>`;
      const lines = p.lists[s.id].map(l => `<label class="prep-line${l.done ? ' done' : ''}"><input type="checkbox" data-list="${s.id}" data-id="${l.id}"${l.done ? ' checked' : ''}>` +
        `<span>${esc(l.text)}</span><button class="icon-x" data-del="${s.id}" data-id="${l.id}" title="Remove">&#x2715;</button></label>`).join('');
      return `<div class="prep-step">${head}${lines}<div class="lk-row" style="margin-top:4px"><input class="prep-add" data-list="${s.id}" maxlength="200" placeholder="Add…" style="flex:1;min-width:0">${picker(s.id)}</div></div>`;
    }).join('') +
    '<button id="prep-clear" class="btn btn-ghost" style="width:100%;margin-top:6px" title="Found clues and played scenes go; the strong start empties; the rest stays">Ready the next session</button>';
  el.oninput = e => { if (e.target.id === 'prep-start') { _state.dmCampaign.prep = { ...currentPrep(), start: e.target.value }; save(); } };
  el.onchange = e => {
    const t = e.target;
    if (t.dataset.pick && t.value) {
      set(addLine(currentPrep(), t.dataset.pick, t.selectedOptions[0].textContent, t.value));
      renderPrepTab();
    } else if (t.type === 'checkbox' && t.dataset.list) {
      set(toggleLine(currentPrep(), t.dataset.list, t.dataset.id));
      renderPrepTab();
    }
  };
  el.onkeydown = e => {
    if (e.key !== 'Enter' || !e.target.classList.contains('prep-add')) return;
    e.preventDefault();
    const list = e.target.dataset.list, text = e.target.value;
    if (!LISTS.includes(list) || !text.trim()) return;
    set(addLine(currentPrep(), list, text.trim()));
    renderPrepTab();
    document.querySelector(`#tab-prep .prep-add[data-list="${list}"]`)?.focus();
  };
  el.onclick = e => {
    if (e.target.dataset.del) { set(removeLine(currentPrep(), e.target.dataset.del, e.target.dataset.id)); renderPrepTab(); }
    else if (e.target.id === 'prep-clear') {
      if (!confirm('Ready the next session? Found clues and played scenes are cleared, and the strong start is emptied.')) return;
      set(clearDone(currentPrep())); renderPrepTab();
    }
  };
}
