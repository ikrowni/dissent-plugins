// dnd-player-spells.js — spell list, slots, SRD data
import { esc } from '../plugin-sdk.js';

let _srdSpells = null;
let _char = null;
let _saveChar = null;

export function setSpellState(char, saveCharFn) { _char = char; _saveChar = saveCharFn; }

export async function loadSRDSpells() {
  if (_srdSpells) return _srdSpells;
  try {
    const r = await fetch(new URL('../dnd-hub/dnd-srd/spells.json', document.baseURI).href);
    _srdSpells = await r.json();
  } catch { _srdSpells = []; }
  return _srdSpells;
}

function findSpell(id) {
  return (_srdSpells || []).find(s => s.id === id) || null;
}

export function renderSpells() {
  if (!_char) return;
  if (!_srdSpells) { loadSRDSpells().then(() => renderSpells()); return; }

  const slotsEl = document.getElementById('spell-slots-grid');
  const slots = _char.spellSlots || [];
  slotsEl.innerHTML = slots.map((pair, i) => {
    if (i === 0) return '';
    const [cur, max] = pair;
    if (max === 0) return '';
    return `
      <div style="text-align:center;padding:6px 10px;background:var(--surface);
        border:1px solid var(--border);border-radius:6px;cursor:pointer"
        onclick="expendSpellSlot(${i})">
        <div style="font-size:9px;color:var(--muted);margin-bottom:3px">Level ${i}</div>
        <div style="display:flex;gap:3px;justify-content:center">
          ${Array.from({length:max}, (_,j) => `
            <div style="width:8px;height:8px;border-radius:50%;
              background:${j < cur ? 'var(--dnd-gold)' : 'rgba(255,255,255,.15)'};
              border:1px solid ${j < cur ? 'var(--dnd-gold)' : 'rgba(255,255,255,.2)'}"></div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  const spellIds = _char.spells || [];
  const cantrips = spellIds.filter(id => findSpell(id)?.level === 0);
  const byLevel = {};
  spellIds.filter(id => { const sp = findSpell(id); return sp && sp.level > 0; }).forEach(id => {
    const sp = findSpell(id);
    if (!sp) return;
    if (!byLevel[sp.level]) byLevel[sp.level] = [];
    byLevel[sp.level].push(sp);
  });

  document.getElementById('cantrips-list').innerHTML = cantrips.length
    ? cantrips.map(id => _renderSpellRow(findSpell(id))).join('')
    : '<div style="font-size:11px;color:var(--muted)">No cantrips</div>';

  document.getElementById('spells-by-level').innerHTML = Object.entries(byLevel)
    .sort(([a],[b]) => Number(a)-Number(b))
    .map(([level, spells]) => `
      <div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">Level ${level} Spells</div>
        ${spells.map(sp => _renderSpellRow(sp)).join('')}
      </div>
    `).join('') || '<div style="font-size:11px;color:var(--muted);padding:8px 0">No spells. Add spells via the DM or character editor.</div>';
}

function _renderSpellRow(sp) {
  if (!sp) return '';
  return `
    <div style="padding:8px;background:var(--surface);border:1px solid var(--border);
      border-radius:6px;margin-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer"
        onclick="toggleSpellExpand('${sp.id}')">
        <div>
          <span style="font-size:12px;font-weight:600">${esc(sp.name)}</span>
          ${sp.concentration ? '<span style="font-size:9px;color:#60a5fa;margin-left:6px">C</span>' : ''}
          ${sp.ritual ? '<span style="font-size:9px;color:var(--dnd-gold);margin-left:4px">R</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:9px;color:var(--muted)">${esc(sp.school)}</span>
          <button onclick="event.stopPropagation();castSpell('${sp.id}')"
            style="padding:3px 8px;background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);
            border-radius:4px;color:var(--dnd-gold);font-size:10px;font-weight:700;cursor:pointer">Cast</button>
        </div>
      </div>
      <div id="spell-detail-${sp.id}" style="display:none;margin-top:6px;font-size:10px;color:var(--muted);line-height:1.5">
        <div><strong>Casting:</strong> ${esc(sp.casting_time)} · <strong>Range:</strong> ${esc(sp.range)}</div>
        <div><strong>Duration:</strong> ${esc(sp.duration)} · <strong>Components:</strong> ${(sp.components||[]).join(', ')}${sp.material?' ('+esc(sp.material)+')':''}</div>
        <div style="margin-top:4px">${esc((sp.desc||'').slice(0,300))}${(sp.desc||'').length>300?'…':''}</div>
      </div>
    </div>
  `;
}

export function toggleSpellExpand(id) {
  const el = document.getElementById(`spell-detail-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export async function expendSpellSlot(level) {
  if (!_char.spellSlots?.[level]) return;
  const [cur, max] = _char.spellSlots[level];
  if (cur <= 0) {
    if (confirm(`Level ${level} slots exhausted. Restore one?`)) {
      _char.spellSlots[level] = [Math.min(cur + 1, max), max];
      await _saveChar();
      renderSpells();
    }
    return;
  }
  _char.spellSlots[level] = [cur - 1, max];
  await _saveChar();
  renderSpells();
}

// ── Concentration ─────────────────────────────────────────────────────────────

export async function setConcentration(spellName, duration) {
  if (!_char) return;
  _char.concentration = { spellName, duration };
  await _saveChar();
  if (typeof window.renderConcentration === 'function') window.renderConcentration();
}

export async function clearConcentration() {
  if (!_char) return;
  _char.concentration = null;
  await _saveChar();
  if (typeof window.renderConcentration === 'function') window.renderConcentration();
}

export async function castSpell(spellId) {
  if (!_char || !_srdSpells) return;
  const sp = findSpell(spellId);
  if (!sp) return;

  if (sp.level === 0) {
    // Cantrip — free, no slot
    if (sp.concentration) await setConcentration(sp.name, sp.duration);
    return;
  }

  // Find lowest available slot at or above spell level
  const slots = _char.spellSlots || [];
  const available = [];
  for (let lvl = sp.level; lvl < slots.length; lvl++) {
    const pair = slots[lvl];
    if (pair && pair[0] > 0) available.push(lvl);
  }

  if (!available.length) {
    alert(`No spell slots available for level ${sp.level}+.`);
    return;
  }

  let chosenLevel = available[0];
  if (available.length > 1) {
    const choice = prompt(
      `Cast at which level? Available: ${available.join(', ')}\nEnter slot level:`,
      String(available[0])
    );
    const parsed = parseInt(choice, 10);
    if (!available.includes(parsed)) return;
    chosenLevel = parsed;
  }

  _char.spellSlots[chosenLevel] = [slots[chosenLevel][0] - 1, slots[chosenLevel][1]];
  if (sp.concentration) await setConcentration(sp.name, sp.duration);
  await _saveChar();
  renderSpells();
}
