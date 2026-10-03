// dnd-master-homebrew.js — World → Homebrew: subclasses and feats the DM types in (spec 2026-10-03 growing your hero
// §2). Level-ups offer them next to the free ones. The PDF import fills the same lists later.
import { esc, genId } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

const CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
let _s = { dmCampaign: null, dmCampaignId: null, serverData: null };
export function setHomebrewState(s) { _s = s; }

const lib = () => { const c = _s.dmCampaign; c.library = c.library || {}; c.library.subclasses = c.library.subclasses || {}; c.library.feats = c.library.feats || {}; return c.library; };
const input = (id, ph, v = '') => `<input id="${id}" placeholder="${ph}" value="${esc(v)}" style="width:100%;margin-bottom:6px">`;
const area = (id, ph) => `<textarea id="${id}" rows="3" placeholder="${ph}" style="width:100%;margin-bottom:6px"></textarea>`;

export function renderHomebrewTab() {
  const el = document.getElementById('tab-homebrew');
  if (!el || !_s.dmCampaign) return;
  const L = lib();
  const list = (items, kind) => Object.values(items).map(x => `<div class="list-row" style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
    <div style="flex:1"><b>${esc(x.name)}</b>${x.classId ? ` <span style="color:var(--muted)">${esc(x.classId)}</span>` : ''}<div style="font-size:10px;color:var(--muted)">${esc((x.description || '').slice(0, 120))}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="deleteHomebrew('${kind}','${esc(x.id)}')">Delete</button></div>`).join('') || '<div style="font-size:11px;color:var(--muted)">None yet.</div>';
  el.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px">SUBCLASSES</div>${list(L.subclasses, 'subclasses')}
    <div style="margin:8px 0 14px">${input('hb-sub-name', 'Name')}
      <select id="hb-sub-class" style="width:100%;margin-bottom:6px">${CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
      ${area('hb-sub-desc', 'What it is, in a line or two')}${area('hb-sub-levels', 'What it gives, level by level (e.g. "3: …  7: …")')}
      <button class="btn btn-gold btn-sm" onclick="addHomebrewSubclass()">Add subclass</button></div>
    <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px">FEATS</div>${list(L.feats, 'feats')}
    <div style="margin:8px 0">${input('hb-feat-name', 'Name')}${input('hb-feat-pre', 'Prerequisite (optional), e.g. "Strength 13"')}${area('hb-feat-desc', 'What it gives')}
      <button class="btn btn-gold btn-sm" onclick="addHomebrewFeat()">Add feat</button></div>
    <div style="font-size:10px;color:var(--muted)">Players see these in level-ups marked ✦; their numbers are applied by hand.</div>`;
}

async function save() { _s.serverData.campaigns[_s.dmCampaignId] = _s.dmCampaign; await saveHubDmCompanion(_s.serverData); renderHomebrewTab(); }
const val = id => document.getElementById(id)?.value?.trim() || '';

export async function addHomebrewSubclass() {
  const name = val('hb-sub-name');
  if (!name) return alert('Give the subclass a name.');
  const id = genId();
  lib().subclasses[id] = { id, name, classId: val('hb-sub-class'), description: val('hb-sub-desc'), levels: val('hb-sub-levels') };
  await save();
}
export async function addHomebrewFeat() {
  const name = val('hb-feat-name');
  if (!name) return alert('Give the feat a name.');
  const id = genId();
  lib().feats[id] = { id, name, prerequisite: val('hb-feat-pre'), description: val('hb-feat-desc') };
  await save();
}
export async function deleteHomebrew(kind, id) {
  if (!confirm('Delete it? Heroes who already chose it keep it.')) return;
  delete lib()[kind][id];
  await save();
}
