// dnd-hub-char-steps.js — character creator step renderers (Race → Review)
import { CC, SRD, ABILITIES, ABILITY_NAMES, STANDARD_ARRAY, ALIGNMENTS, abilityMod, fmtMod } from './dnd-hub-state.js?v=20260502p4';
import { esc } from '../plugin-sdk.js';

// ── Race ──────────────────────────────────────────────────────────────────────
export function renderCCRace(el) {
  const races = SRD.races || [];
  el.innerHTML = `
    <div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">
      Choose your character's race. Each race grants different ability score bonuses, traits, and features.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${races.map(r => `
        <div data-race="${r.id}" onclick="selectRace('${r.id}')"
          style="padding:12px;background:var(--dnd-surface);border:1px solid ${CC.draft.race===r.id?'var(--dnd-gold)':'var(--dnd-border)'};border-radius:8px;cursor:pointer;transition:all .15s">
          <div style="font-size:13px;font-weight:700;margin-bottom:3px">${esc(r.name)}</div>
          <div style="font-size:10px;color:var(--dnd-muted)">
            Speed ${r.speed}ft · ${r.ability_bonuses.map(b => `${b.ability} +${b.bonus}`).join(', ') || 'No bonuses'}
          </div>
          ${r.darkvision ? `<div style="font-size:9px;color:var(--dnd-gold);margin-top:3px">Darkvision ${r.darkvision}ft</div>` : ''}
        </div>
      `).join('')}
    </div>
    <div id="cc-subrace-section" style="margin-top:14px"></div>
    <div id="cc-race-traits" style="margin-top:14px"></div>
  `;
  if (CC.draft.race) renderRaceDetails(CC.draft.race);
}

export function selectRace(raceId) {
  CC.draft.race = raceId;
  CC.draft.subrace = null;
  document.querySelectorAll('[data-race]').forEach(c => {
    const sel = c.dataset.race === raceId;
    c.style.borderColor = sel ? 'var(--dnd-gold)' : 'var(--dnd-border)';
    c.style.background = sel ? 'rgba(212,175,55,0.1)' : 'var(--dnd-surface)';
  });
  renderRaceDetails(raceId);
}

export function renderRaceDetails(raceId) {
  const race = (SRD.races || []).find(r => r.id === raceId);
  if (!race) return;
  const subEl = document.getElementById('cc-subrace-section');
  if (subEl && race.subraces?.length) {
    subEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--dnd-gold);margin-bottom:8px">Subrace</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="btn btn-sm ${!CC.draft.subrace?'btn-gold':'btn-ghost'}" onclick="selectSubrace(null)">None</div>
        ${race.subraces.map(s => `
          <div class="btn btn-sm ${CC.draft.subrace===s.id?'btn-gold':'btn-ghost'}" onclick="selectSubrace('${s.id}')">${esc(s.name)}</div>
        `).join('')}
      </div>
    `;
  } else if (subEl) { subEl.innerHTML = ''; }
  const traitEl = document.getElementById('cc-race-traits');
  if (traitEl && race.traits?.length) {
    traitEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--dnd-gold);margin-bottom:8px">Racial Traits</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${race.traits.map(t => `
          <div style="padding:8px 10px;background:rgba(212,175,55,.05);border-radius:6px;border-left:2px solid var(--dnd-gold)">
            <div style="font-size:12px;font-weight:600">${esc(t.name)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (traitEl) { traitEl.innerHTML = ''; }
}

export function selectSubrace(subraceId) {
  CC.draft.subrace = subraceId;
  const race = (SRD.races || []).find(r => r.id === CC.draft.race);
  const subEl = document.getElementById('cc-subrace-section');
  if (!subEl || !race) return;
  subEl.querySelectorAll('.btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick');
    const isSelected = onclick === `selectSubrace(null)` ? subraceId === null
      : onclick === `selectSubrace('${subraceId}')`;
    btn.className = `btn btn-sm ${isSelected ? 'btn-gold' : 'btn-ghost'}`;
  });
}

// ── Class ─────────────────────────────────────────────────────────────────────
export function renderCCClass(el) {
  const classes = SRD.classes || [];
  el.innerHTML = `
    <div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">
      Choose your character's class. This determines your hit die, proficiencies, and core abilities.
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${classes.map(c => `
        <div data-class="${c.id}" onclick="selectClass('${c.id}')"
          style="padding:12px 14px;background:${CC.draft.class===c.id?'rgba(212,175,55,0.08)':'var(--dnd-surface)'};border:1px solid ${CC.draft.class===c.id?'var(--dnd-gold)':'var(--dnd-border)'};border-radius:8px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:10px">
          <div style="font-size:22px">${classIcon(c.id)}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${esc(c.name)}</div>
            <div style="font-size:10px;color:var(--dnd-muted)">Hit die: d${c.hit_die} · Saves: ${c.saving_throws.join(', ')}${c.spellcasting_ability ? ` · Spellcasting: ${c.spellcasting_ability}` : ''}</div>
          </div>
          ${CC.draft.class===c.id ? '<span style="color:var(--dnd-gold);font-size:18px">✓</span>' : ''}
        </div>
      `).join('')}
    </div>
    <div id="cc-subclass-section" style="margin-top:14px"></div>
  `;
  if (CC.draft.class) renderSubclassOptions(CC.draft.class);
}

export function classIcon(classId) {
  const icons = { barbarian:'🪓',bard:'🎵',cleric:'✝️',druid:'🌿',fighter:'⚔️',monk:'👊',paladin:'🛡️',ranger:'🏹',rogue:'🗡️',sorcerer:'✨',warlock:'🌑',wizard:'📚' };
  return icons[classId] || '⚔️';
}

export function selectClass(classId) {
  CC.draft.class = classId;
  CC.draft.subclass = null;
  document.querySelectorAll('[data-class]').forEach(card => {
    const sel = card.dataset.class === classId;
    card.style.borderColor = sel ? 'var(--dnd-gold)' : 'var(--dnd-border)';
    card.style.background = sel ? 'rgba(212,175,55,0.08)' : 'var(--dnd-surface)';
  });
  renderSubclassOptions(classId);
}

export function renderSubclassOptions(classId) {
  const cls = (SRD.classes || []).find(c => c.id === classId);
  const el = document.getElementById('cc-subclass-section');
  if (!el || !cls?.subclasses?.length) { if (el) el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--dnd-gold);margin-bottom:8px">Subclass (optional at level 1)</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <div class="btn btn-sm ${!CC.draft.subclass?'btn-gold':'btn-ghost'}" onclick="CC.draft.subclass=null;renderSubclassOptions('${classId}')">None yet</div>
      ${cls.subclasses.map(s => `
        <div class="btn btn-sm ${CC.draft.subclass===s.id?'btn-gold':'btn-ghost'}" onclick="CC.draft.subclass='${s.id}';renderSubclassOptions('${classId}')">${esc(s.name)}</div>
      `).join('')}
    </div>
  `;
}

// ── Ability Scores ────────────────────────────────────────────────────────────
export function renderCCAbilityScores(el) {
  el.innerHTML = `
    <div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">Set your six ability scores. Choose a method below.</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <div class="btn btn-sm ${CC.draft.abilityMethod==='standard-array'?'btn-gold':'btn-ghost'}" onclick="selectAbilityMethod('standard-array')">Standard Array</div>
      <div class="btn btn-sm ${CC.draft.abilityMethod==='point-buy'?'btn-gold':'btn-ghost'}" onclick="selectAbilityMethod('point-buy')">Point Buy</div>
      <div class="btn btn-sm ${CC.draft.abilityMethod==='manual-roll'?'btn-gold':'btn-ghost'}" onclick="selectAbilityMethod('manual-roll')">Roll Dice</div>
    </div>
    <div id="cc-ability-method-ui"></div>
  `;
  renderAbilityMethodUI();
}

export function selectAbilityMethod(method) {
  CC.draft.abilityMethod = method;
  if (method === 'standard-array') CC.draft.baseScores = { str:0, dex:0, con:0, int:0, wis:0, cha:0 };
  else if (method === 'point-buy') CC.draft.baseScores = { str:8, dex:8, con:8, int:8, wis:8, cha:8 };
  renderCCAbilityScores(document.getElementById('cc-content'));
}

export function renderAbilityMethodUI() {
  const el = document.getElementById('cc-ability-method-ui');
  if (!el) return;
  const m = CC.draft.abilityMethod;
  if (m === 'standard-array') {
    el.innerHTML = `
      <div style="font-size:11px;color:var(--dnd-muted);margin-bottom:10px">
        Assign these values to your abilities: <strong>${STANDARD_ARRAY.join(', ')}</strong>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${ABILITIES.map(a => `
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:80px;font-size:12px;font-weight:600">${ABILITY_NAMES[a]}</div>
            <select onchange="CC.draft.baseScores.${a}=parseInt(this.value)||0;renderAbilityMethodUI()"
              style="background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:6px;padding:6px 10px;color:var(--dnd-text);font-size:13px">
              <option value="0">— choose —</option>
              ${STANDARD_ARRAY.map(v => `<option value="${v}" ${CC.draft.baseScores[a]===v?'selected':''}>${v}</option>`).join('')}
            </select>
            <div style="font-size:13px;color:var(--dnd-gold);width:30px;text-align:right">
              ${CC.draft.baseScores[a] ? fmtMod(abilityMod(CC.draft.baseScores[a])) : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (m === 'point-buy') {
    const spent = ABILITIES.reduce((sum, a) => sum + pointBuyCost(CC.draft.baseScores[a] || 8), 0);
    const remaining = 27 - spent;
    el.innerHTML = `
      <div style="font-size:11px;color:var(--dnd-muted);margin-bottom:10px">
        You have <strong style="color:var(--dnd-gold)">${remaining} points</strong> remaining. Scores range from 8–15.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${ABILITIES.map(a => {
          const score = CC.draft.baseScores[a] || 8;
          return `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:80px;font-size:12px;font-weight:600">${ABILITY_NAMES[a]}</div>
              <button class="btn btn-ghost btn-sm" ${score<=8?'disabled':''} onclick="adjustPB('${a}',-1)">−</button>
              <span style="font-size:14px;font-weight:700;width:24px;text-align:center">${score}</span>
              <button class="btn btn-ghost btn-sm" ${score>=15||remaining<=0?'disabled':''} onclick="adjustPB('${a}',1)">+</button>
              <span style="font-size:11px;color:var(--dnd-muted)">(${pointBuyCost(score)} pts)</span>
              <div style="font-size:13px;color:var(--dnd-gold);margin-left:auto">${fmtMod(abilityMod(score))}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (m === 'manual-roll') {
    el.innerHTML = `
      <div style="font-size:11px;color:var(--dnd-muted);margin-bottom:10px">Roll 4d6 and drop the lowest die for each ability score.</div>
      <div style="display:flex;flex-direction:column;gap:8px" id="cc-roll-list">
        ${ABILITIES.map(a => `
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:80px;font-size:12px;font-weight:600">${ABILITY_NAMES[a]}</div>
            <span style="font-size:18px;font-weight:800;color:var(--dnd-gold);width:28px">${CC.draft.baseScores[a] || '—'}</span>
            <span style="font-size:11px;color:var(--dnd-muted)" id="cc-roll-dice-${a}"></span>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost" style="margin-top:12px;width:100%" onclick="rollAllAbilities()">🎲 Roll All Abilities</button>
    `;
  }
}

export function pointBuyCost(score) {
  if (score <= 13) return score - 8;
  if (score === 14) return 7;
  if (score === 15) return 9;
  return 0;
}

export function adjustPB(ability, delta) {
  const cur = CC.draft.baseScores[ability] || 8;
  const next = Math.max(8, Math.min(15, cur + delta));
  const spent = ABILITIES.reduce((sum, a) => sum + pointBuyCost(a === ability ? next : (CC.draft.baseScores[a] || 8)), 0);
  if (spent > 27) return;
  CC.draft.baseScores[ability] = next;
  renderAbilityMethodUI();
}

export function rollAllAbilities() {
  ABILITIES.forEach(a => {
    const dice = [0, 0, 0, 0].map(() => Math.ceil(Math.random() * 6));
    const dropped = Math.min(...dice);
    CC.draft.baseScores[a] = dice.reduce((s, d) => s + d, 0) - dropped;
  });
  renderAbilityMethodUI();
}

// ── Background ────────────────────────────────────────────────────────────────
export function renderCCBackground(el) {
  const backgrounds = SRD.backgrounds || [];
  el.innerHTML = `
    <div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">
      Your background provides additional skill proficiencies, starting equipment, and a special feature.
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${backgrounds.map(b => `
        <div data-bg="${b.id}" onclick="selectBackground('${b.id}')"
          style="padding:12px 14px;background:var(--dnd-surface);border:1px solid ${CC.draft.background===b.id?'var(--dnd-gold)':'var(--dnd-border)'};border-radius:8px;cursor:pointer;transition:all .15s">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div style="font-size:13px;font-weight:700">${esc(b.name)}</div>
            ${CC.draft.background===b.id ? '<span style="color:var(--dnd-gold)">✓</span>' : ''}
          </div>
          <div style="font-size:10px;color:var(--dnd-muted)">
            Skills: ${b.starting_proficiencies.slice(0, 3).join(', ') || 'None'}
          </div>
          ${CC.draft.background===b.id && b.feature ? `
            <div style="margin-top:8px;padding:8px;background:rgba(212,175,55,.06);border-radius:6px;border-left:2px solid var(--dnd-gold)">
              <div style="font-size:11px;font-weight:700;color:var(--dnd-gold)">${esc(b.feature.name)}</div>
              <div style="font-size:10px;color:var(--dnd-muted);margin-top:2px;line-height:1.4">${esc((b.feature.desc||'').slice(0,200))}${(b.feature.desc||'').length>200?'…':''}</div>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

export function selectBackground(bgId) {
  CC.draft.background = bgId;
  renderCCBackground(document.getElementById('cc-content'));
}

// ── Equipment ─────────────────────────────────────────────────────────────────
export function renderCCEquipment(el) {
  const items = SRD.equipment || [];
  el.innerHTML = `
    <div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">
      Choose your starting equipment or take starting gold to buy your own.
    </div>
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div class="btn btn-sm ${!CC.draft.useStartingGold?'btn-gold':'btn-ghost'}" onclick="CC.draft.useStartingGold=false;renderCCEquipment(document.getElementById('cc-content'))">Starting Equipment</div>
      <div class="btn btn-sm ${CC.draft.useStartingGold?'btn-gold':'btn-ghost'}" onclick="CC.draft.useStartingGold=true;renderCCEquipment(document.getElementById('cc-content'))">Starting Gold</div>
    </div>
    ${!CC.draft.useStartingGold ? `
      <div style="font-size:11px;color:var(--dnd-muted);margin-bottom:10px">Selected: ${CC.draft.equipment.length} items</div>
      <input type="text" id="cc-equip-search" placeholder="Search equipment…" oninput="filterEquipment()"
        style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:8px 12px;color:var(--dnd-text);font-size:13px;outline:none;margin-bottom:10px">
      <div id="cc-equip-list" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${renderEquipmentList(items.slice(0, 40))}
      </div>
    ` : `
      <div style="padding:16px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">🪙</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Starting Gold</div>
        <div style="font-size:12px;color:var(--dnd-muted);margin-bottom:14px">You'll start with gold based on your class.</div>
        <div style="font-size:28px;font-weight:800;color:var(--dnd-gold)">${getStartingGold()} gp</div>
      </div>
    `}
  `;
}

export function renderEquipmentList(items) {
  return items.map(item => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:${CC.draft.equipment.includes(item.id)?'rgba(212,175,55,.08)':'var(--dnd-surface)'};border:1px solid ${CC.draft.equipment.includes(item.id)?'var(--dnd-gold)':'var(--dnd-border)'};border-radius:6px;cursor:pointer;transition:all .15s" onclick="toggleEquipItem('${item.id}')">
      <input type="checkbox" ${CC.draft.equipment.includes(item.id)?'checked':''} style="pointer-events:none">
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600">${esc(item.name)}</div>
        <div style="font-size:10px;color:var(--dnd-muted)">${item.cost || '—'} · ${item.weight ? item.weight+'lb' : '—'}${item.damage ? ` · ${item.damage}` : ''}</div>
      </div>
    </div>
  `).join('');
}

export function toggleEquipItem(itemId) {
  const idx = CC.draft.equipment.indexOf(itemId);
  if (idx >= 0) CC.draft.equipment.splice(idx, 1);
  else CC.draft.equipment.push(itemId);
  renderCCEquipment(document.getElementById('cc-content'));
}

export function filterEquipment() {
  const q = document.getElementById('cc-equip-search')?.value.toLowerCase() || '';
  const items = (SRD.equipment || []).filter(e => e.name.toLowerCase().includes(q)).slice(0, 40);
  const list = document.getElementById('cc-equip-list');
  if (list) list.innerHTML = renderEquipmentList(items);
}

export function getStartingGold() {
  const goldByClass = { barbarian:75,bard:125,cleric:125,druid:50,fighter:150,monk:12,paladin:150,ranger:150,rogue:100,sorcerer:75,warlock:100,wizard:100 };
  return goldByClass[CC.draft.class] || 75;
}

// ── Spells ────────────────────────────────────────────────────────────────────
// Cantrips/spells known at level 1 per class (SRD classes.json has no spellcasting table)
const CANTRIPS_KNOWN = { bard:2, cleric:3, druid:2, sorcerer:4, warlock:2, wizard:3 };
const SPELLS_KNOWN_L1 = { bard:4, sorcerer:2, warlock:2 }; // prepared casters (cleric/druid/paladin/ranger) can pick freely
const SPELLCASTING_CLASSES = new Set(['bard','cleric','druid','paladin','ranger','sorcerer','warlock','wizard','artificer']);

export function renderCCSpells(el) {
  const cls = (SRD.classes || []).find(c => c.id === CC.draft.class);
  if (!cls || !SPELLCASTING_CLASSES.has(cls.id)) {
    el.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--dnd-muted)">
        <div style="font-size:36px;margin-bottom:12px">⚔️</div>
        <div style="font-size:14px;font-weight:700;color:var(--dnd-text);margin-bottom:6px">No Spellcasting</div>
        <div style="font-size:12px">The ${esc(cls?.name || 'selected class')} relies on martial prowess rather than magic.</div>
        <div style="font-size:11px;margin-top:8px;color:var(--dnd-gold)">Click Next to continue →</div>
      </div>
    `;
    return;
  }

  const allSpells = SRD.spells || [];
  const clsName = cls.name;
  const clsSpells = allSpells.filter(s => Array.isArray(s.classes) && s.classes.includes(clsName));
  const cantrips = clsSpells.filter(s => s.level === 0);
  const level1Spells = clsSpells.filter(s => s.level === 1);

  const cantripLimit = CANTRIPS_KNOWN[cls.id] ?? 0;
  const spellLimit = SPELLS_KNOWN_L1[cls.id] ?? (level1Spells.length > 0 ? 999 : 0); // prepared casters: no fixed limit
  const isPrepared = !SPELLS_KNOWN_L1[cls.id] && SPELLCASTING_CLASSES.has(cls.id);

  el.innerHTML = `
    <div style="font-size:12px;color:var(--dnd-muted);margin-bottom:14px;line-height:1.5">
      Choose your starting spells for <strong style="color:var(--dnd-gold)">${esc(clsName)}</strong>.
      ${cantripLimit > 0 ? `Select <strong>${cantripLimit}</strong> cantrip${cantripLimit>1?'s':''}.` : ''}
      ${isPrepared ? 'You prepare spells each long rest — choose your starting prepared spells.' :
        spellLimit > 0 ? `Select up to <strong>${spellLimit}</strong> 1st-level spell${spellLimit>1?'s':''}.` : ''}
    </div>
    ${cantrips.length > 0 ? `
      <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
        Cantrips (${(CC.draft.cantrips||[]).length}/${cantripLimit > 0 ? cantripLimit : '∞'})
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px" id="cc-cantrip-list">
        ${cantrips.map(s => renderSpellRow(s, 'cantrip')).join('')}
      </div>
    ` : ''}
    ${level1Spells.length > 0 ? `
      <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
        1st-Level Spells (${(CC.draft.spells||[]).length}${spellLimit < 999 ? '/'+spellLimit : ''})
      </div>
      <div style="display:flex;flex-direction:column;gap:4px" id="cc-spell-list">
        ${level1Spells.map(s => renderSpellRow(s, 'spell')).join('')}
      </div>
    ` : ''}
  `;
}

function renderSpellRow(spell, type) {
  const selected = type === 'cantrip'
    ? (CC.draft.cantrips || []).includes(spell.id)
    : (CC.draft.spells || []).includes(spell.id);
  return `
    <div onclick="toggleSpell('${esc(spell.id)}','${type}')"
      style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;background:var(--dnd-surface);
             border:1px solid ${selected?'var(--dnd-gold)':'var(--dnd-border)'};border-radius:7px;cursor:pointer;
             transition:border-color .15s;${selected?'background:rgba(212,175,55,.08)':''}">
      <div style="width:16px;height:16px;border-radius:3px;border:1px solid ${selected?'var(--dnd-gold)':'var(--dnd-border)'};
                  background:${selected?'var(--dnd-gold)':'transparent'};flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;font-size:10px">
        ${selected?'✓':''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${esc(spell.name)}</div>
        <div style="font-size:10px;color:var(--dnd-muted)">${esc(spell.school||'')}${spell.casting_time?' · '+esc(spell.casting_time):''}${spell.range?' · '+esc(spell.range):''}</div>
        ${spell.description ? `<div style="font-size:10px;color:var(--dnd-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(spell.description.slice(0,80))}${spell.description.length>80?'…':''}</div>` : ''}
      </div>
    </div>
  `;
}

export function toggleSpell(spellId, type) {
  if (!CC.draft.spells) CC.draft.spells = [];
  if (!CC.draft.cantrips) CC.draft.cantrips = [];

  const cls = (SRD.classes || []).find(c => c.id === CC.draft.class);
  if (type === 'cantrip') {
    const cantripLimit = CANTRIPS_KNOWN[cls?.id] ?? 0;
    const idx = CC.draft.cantrips.indexOf(spellId);
    if (idx >= 0) { CC.draft.cantrips.splice(idx, 1); }
    else if (cantripLimit <= 0 || CC.draft.cantrips.length < cantripLimit) { CC.draft.cantrips.push(spellId); }
  } else {
    const spellLimit = SPELLS_KNOWN_L1[cls?.id] ?? 999;
    const idx = CC.draft.spells.indexOf(spellId);
    if (idx >= 0) { CC.draft.spells.splice(idx, 1); }
    else if (CC.draft.spells.length < spellLimit) { CC.draft.spells.push(spellId); }
  }
  renderCCSpells(document.getElementById('cc-content'));
}

// ── Description ───────────────────────────────────────────────────────────────
export function renderCCDescription(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;
        background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:10px">
        <div style="font-size:11px;font-weight:600;color:var(--dnd-gold)">Character Portrait (optional)</div>
        <div id="cc-portrait-preview" style="width:72px;height:72px;border-radius:50%;
          background:rgba(255,255,255,.08);border:2px solid var(--dnd-border);
          display:flex;align-items:center;justify-content:center;font-size:28px;overflow:hidden">
          ${CC.draft.portraitUrl
            ? `<img src="${esc(CC.draft.portraitUrl)}" style="width:100%;height:100%;object-fit:cover">`
            : '🧙'}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="triggerPortraitUpload()">
          ${CC.draft.portraitUrl ? '🔄 Change Portrait' : '📷 Upload Portrait'}
        </button>
        <input type="file" id="cc-portrait-input" accept="image/*" style="display:none"
          onchange="handlePortraitUpload(this)">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Character Name *</label>
        <input type="text" id="cc-char-name" value="${esc(CC.draft.name)}" placeholder="Enter your character's name"
          oninput="CC.draft.name=this.value"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:14px;outline:none">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Alignment</label>
        <select onchange="CC.draft.alignment=this.value"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:13px">
          ${ALIGNMENTS.map(a => `<option value="${a}" ${CC.draft.alignment===a?'selected':''}>${a}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Deity / Faith (optional)</label>
        <input type="text" value="${esc(CC.draft.deity)}" placeholder="e.g. Lathander, Tymora"
          oninput="CC.draft.deity=this.value" maxlength="60"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:13px;outline:none">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Personality Trait</label>
        <textarea rows="2" placeholder="How does your character act day-to-day?" maxlength="300"
          oninput="CC.draft.personalityTraits=this.value"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:13px;outline:none;resize:vertical">${esc(CC.draft.personalityTraits)}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Ideal</label>
          <textarea rows="2" maxlength="200" oninput="CC.draft.ideals=this.value" placeholder="What do you believe in?"
            style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:8px 10px;color:var(--dnd-text);font-size:12px;outline:none;resize:vertical">${esc(CC.draft.ideals)}</textarea>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Bond</label>
          <textarea rows="2" maxlength="200" oninput="CC.draft.bonds=this.value" placeholder="What ties you to the world?"
            style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:8px 10px;color:var(--dnd-text);font-size:12px;outline:none;resize:vertical">${esc(CC.draft.bonds)}</textarea>
        </div>
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Flaw</label>
        <textarea rows="2" maxlength="200" oninput="CC.draft.flaws=this.value" placeholder="What weakness holds your character back?"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:8px 10px;color:var(--dnd-text);font-size:13px;outline:none;resize:vertical">${esc(CC.draft.flaws)}</textarea>
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Backstory</label>
        <textarea rows="4" maxlength="1000" oninput="CC.draft.backstory=this.value" placeholder="Where did your character come from?"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:13px;outline:none;resize:vertical">${esc(CC.draft.backstory)}</textarea>
      </div>
    </div>
  `;
}

// ── Review ────────────────────────────────────────────────────────────────────
export function renderCCReview(el) {
  const race = (SRD.races || []).find(r => r.id === CC.draft.race);
  const cls = (SRD.classes || []).find(c => c.id === CC.draft.class);
  const bg = (SRD.backgrounds || []).find(b => b.id === CC.draft.background);

  const finalScores = { ...CC.draft.baseScores };
  if (race) {
    race.ability_bonuses.forEach(b => {
      const key = b.ability?.toLowerCase().slice(0, 3);
      if (key && finalScores[key] !== undefined) finalScores[key] += b.bonus;
    });
  }

  const profBonus = Math.ceil(1 + CC.draft.level / 4);
  const conMod = abilityMod(finalScores.con || 10);
  const hitDie = cls?.hit_die || 8;
  const maxHP = hitDie + conMod;
  const ac = 10 + abilityMod(finalScores.dex || 10);
  const initiative = abilityMod(finalScores.dex || 10);

  el.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:36px;margin-bottom:6px">⚔️</div>
      <div style="font-size:22px;font-weight:900;color:var(--dnd-gold)">${esc(CC.draft.name || 'Unnamed Hero')}</div>
      <div style="font-size:13px;color:var(--dnd-muted);margin-top:4px">${race?.name || '—'} ${cls?.name || '—'} · Level ${CC.draft.level}${bg ? ` · ${bg.name}` : ''}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="text-align:center;padding:12px;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px">
        <div style="font-size:22px">❤️</div><div style="font-size:20px;font-weight:800;color:var(--dnd-gold)">${maxHP}</div>
        <div style="font-size:9px;color:var(--dnd-muted);text-transform:uppercase;letter-spacing:.05em">Max HP</div>
      </div>
      <div style="text-align:center;padding:12px;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px">
        <div style="font-size:22px">🛡️</div><div style="font-size:20px;font-weight:800;color:var(--dnd-gold)">${ac}</div>
        <div style="font-size:9px;color:var(--dnd-muted);text-transform:uppercase;letter-spacing:.05em">Armour Class</div>
      </div>
      <div style="text-align:center;padding:12px;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px">
        <div style="font-size:22px">⚡</div><div style="font-size:20px;font-weight:800;color:var(--dnd-gold)">${fmtMod(initiative)}</div>
        <div style="font-size:9px;color:var(--dnd-muted);text-transform:uppercase;letter-spacing:.05em">Initiative</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px">
      ${ABILITIES.map(a => `
        <div style="text-align:center;padding:10px;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px">
          <div style="font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--dnd-muted);text-transform:uppercase;margin-bottom:2px">${a.toUpperCase()}</div>
          <div style="font-size:18px;font-weight:800;color:var(--dnd-text)">${finalScores[a]||10}</div>
          <div style="font-size:11px;color:var(--dnd-gold)">${fmtMod(abilityMod(finalScores[a]||10))}</div>
        </div>
      `).join('')}
    </div>
    <div style="padding:12px;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;font-size:11px;color:var(--dnd-muted);line-height:1.6">
      <div><strong style="color:var(--dnd-text)">Alignment:</strong> ${CC.draft.alignment}</div>
      <div><strong style="color:var(--dnd-text)">Proficiency Bonus:</strong> ${fmtMod(profBonus)}</div>
      ${CC.draft.deity ? `<div><strong style="color:var(--dnd-text)">Deity:</strong> ${esc(CC.draft.deity)}</div>` : ''}
      ${bg ? `<div><strong style="color:var(--dnd-text)">Feature:</strong> ${esc(bg.feature?.name || '')}</div>` : ''}
    </div>
    <div style="margin-top:14px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;font-size:12px;color:#86efac;text-align:center">
      ✅ Everything looks good! Click <strong>Finish &amp; Create Character</strong> below to begin your adventure.
    </div>
  `;
}

// ── Portrait upload helpers ───────────────────────────────────────────────────
export function triggerPortraitUpload() {
  document.getElementById('cc-portrait-input')?.click();
}

export async function handlePortraitUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  const btn = document.querySelector('#cc-portrait-preview + button') ||
    document.querySelector('[onclick="triggerPortraitUpload()"]');
  if (btn) btn.textContent = '⏳ Uploading…';
  try {
    const buf = await file.arrayBuffer();
    const { request } = await import('../plugin-sdk.js');
    const result = await request('files:upload', { data: buf, name: file.name, mime: file.type });
    CC.draft.portraitUrl    = result.url;
    CC.draft.portraitFileId = result.id;
    const preview = document.getElementById('cc-portrait-preview');
    if (preview) preview.innerHTML = `<img src="${esc(result.url)}" style="width:100%;height:100%;object-fit:cover">`;
    if (btn) btn.textContent = '🔄 Change Portrait';
  } catch (err) {
    alert('Portrait upload failed: ' + err.message);
    if (btn) btn.textContent = '📷 Upload Portrait';
  }
  input.value = '';
}
