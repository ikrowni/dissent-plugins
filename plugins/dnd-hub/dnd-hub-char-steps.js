// dnd-hub-char-steps.js — character creator step renderers (Race → Review)
import { CC, SRD, ABILITIES, ABILITY_NAMES, STANDARD_ARRAY, ALIGNMENTS, abilityMod, fmtMod } from './dnd-hub-state.js?v=20261015x';
import { esc } from '../plugin-sdk.js';
import { proficiencyLabel, racialBonus, finalScore, modifier } from './dnd-hub-char-format.js';
import { armorClass } from './lk-rules5e.js';
import { setGearTarget, gearStepHtml } from './dnd-hub-gear-view.js';
import { CANTRIPS_KNOWN, spellLimitL1 as spellLimitFor, classSkillChoice as skillChoiceFor, draftScores as scoresFor } from './dnd-hub-draft-rules.js';

import { guarded } from './lk-upload.js';
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
    <div id="cc-skill-section" style="margin-top:14px"></div>
  `;
  if (CC.draft.class) { renderSubclassOptions(CC.draft.class); renderSkillChoices(); }
}

/** The class's "choose N skills" (and Half-Elf's two of any). Every hero used to have no skills at all. */
export function classSkillChoice(classId) { return skillChoiceFor(SRD.classes, classId); }
const ALL_SKILLS = ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation',
  'Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];

export function renderSkillChoices() {
  const el = document.getElementById('cc-skill-section');
  if (!el || !CC.draft.class) return;
  const { choose, from } = classSkillChoice(CC.draft.class);
  const picked = CC.draft.proficiencyChoices || [];
  const extra = CC.draft.extraSkills || [];
  const chip = (name, on, fn) => `<div class="btn btn-sm ${on ? 'btn-gold' : 'btn-ghost'}" onclick="${fn}('${esc(name)}')">${esc(name)}</div>`;
  el.innerHTML = choose ? `
    <div style="font-size:12px;font-weight:600;color:var(--dnd-gold);margin-bottom:8px">Skills — choose ${choose} (${picked.length}/${choose})</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${from.map(n => chip(n, picked.includes(n), 'toggleClassSkill')).join('')}</div>
    ${CC.draft.race === 'half-elf' ? `
      <div style="font-size:12px;font-weight:600;color:var(--dnd-gold);margin:12px 0 8px">Half-elf: two more skills of any kind (${extra.length}/2)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${ALL_SKILLS.filter(n => !picked.includes(n)).map(n => chip(n, extra.includes(n), 'toggleExtraSkill')).join('')}</div>` : ''}
  ` : '';
}

function _toggleIn(list, name, max) {
  const i = list.indexOf(name);
  if (i >= 0) list.splice(i, 1); else if (list.length < max) list.push(name);
}
export function toggleClassSkill(name) {
  CC.draft.proficiencyChoices = CC.draft.proficiencyChoices || [];
  _toggleIn(CC.draft.proficiencyChoices, name, classSkillChoice(CC.draft.class).choose);
  CC.draft.extraSkills = (CC.draft.extraSkills || []).filter(n => !CC.draft.proficiencyChoices.includes(n));
  renderSkillChoices();
}
export function toggleExtraSkill(name) {
  CC.draft.extraSkills = CC.draft.extraSkills || [];
  _toggleIn(CC.draft.extraSkills, name, 2);
  renderSkillChoices();
}

export function classIcon(classId) {
  const icons = { barbarian:'🪓',bard:'🎵',cleric:'✝️',druid:'🌿',fighter:'⚔️',monk:'👊',paladin:'🛡️',ranger:'🏹',rogue:'🗡️',sorcerer:'✨',warlock:'🌑',wizard:'📚' };
  return icons[classId] || '⚔️';
}

export function selectClass(classId) {
  CC.draft.class = classId;
  CC.draft.subclass = null;
  CC.draft.proficiencyChoices = [];
  CC.draft.spells = []; CC.draft.cantrips = [];
  document.querySelectorAll('[data-class]').forEach(card => {
    const sel = card.dataset.class === classId;
    card.style.borderColor = sel ? 'var(--dnd-gold)' : 'var(--dnd-border)';
    card.style.background = sel ? 'rgba(212,175,55,0.08)' : 'var(--dnd-surface)';
  });
  renderSubclassOptions(classId);
  renderSkillChoices();
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
    <div id="cc-half-elf"></div>
  `;
  renderAbilityMethodUI();
}

export function selectAbilityMethod(method) {
  CC.draft.abilityMethod = method;
  if (method === 'standard-array') CC.draft.baseScores = { str:0, dex:0, con:0, int:0, wis:0, cha:0 };
  else if (method === 'point-buy') CC.draft.baseScores = { str:8, dex:8, con:8, int:8, wis:8, cha:8 };
  renderCCAbilityScores(document.getElementById('cc-content'));
}

// "+2 Dwarf → 15 (+2)" beside an ability, so the racial bonus is visible while choosing.
// It used to appear only on the review step, which made the modifiers here look wrong.
function _raceNote(a, base) {
  const race = (SRD.races || []).find(r => r.id === CC.draft.race);
  const sub = race?.subraces?.find(s => s.id === CC.draft.subrace) || null;
  const bonus = racialBonus(race, sub, a.toUpperCase());
  if (!bonus || !base) return '';
  const total = finalScore(base, bonus);
  return `<span style="font-size:11px;color:var(--dnd-muted);white-space:nowrap">+${bonus} ${esc(race.name)} → <strong style="color:var(--dnd-gold)">${total} (${fmtMod(modifier(total))})</strong></span>`;
}

function _halfElfPicker() {
  if (CC.draft.race !== 'half-elf') return '';
  const pick = CC.draft.halfElfBonus || ['', ''];
  const sel = i => `<select onchange="setHalfElfBonus(${i}, this.value)"
      style="background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:6px;padding:6px 10px;color:var(--dnd-text);font-size:12px">
      <option value="">— choose —</option>
      ${ABILITIES.filter(a => a !== 'cha').map(a => `<option value="${a}" ${pick[i] === a ? 'selected' : ''} ${pick[1 - i] === a ? 'disabled' : ''}>${ABILITY_NAMES[a]}</option>`).join('')}
    </select>`;
  return `<div style="margin-top:14px;font-size:12px;color:var(--dnd-gold);font-weight:600">Half-elf: +1 to two other abilities</div>
    <div style="display:flex;gap:8px;margin-top:6px">${sel(0)}${sel(1)}</div>`;
}

export function renderAbilityMethodUI() {
  const el = document.getElementById('cc-ability-method-ui');
  if (!el) return;
  const he = document.getElementById('cc-half-elf');
  if (he) he.innerHTML = _halfElfPicker();
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
            ${_raceNote(a, CC.draft.baseScores[a])}
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
              ${_raceNote(a, score)}
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
            ${_raceNote(a, CC.draft.baseScores[a])}
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
            Skills: ${b.starting_proficiencies.slice(0, 3).map(proficiencyLabel).join(', ') || 'None'}
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
// The class's choices or starting gold, shared with the Hero Forge (dnd-hub-gear-view.js).
export function renderCCEquipment(el) {
  setGearTarget({ draft: () => CC.draft, srd: SRD, budgetGp: () => getStartingGold(), redraw: () => renderCCEquipment(document.getElementById('cc-content')) });
  el.innerHTML = `<div style="font-size:13px;color:var(--dnd-muted);margin-bottom:14px">What you carry into your first adventure. Armour you take is worn and weapons are ready.</div>`
    + gearStepHtml(CC.draft, SRD, getStartingGold());
}

export function getStartingGold(cls = CC.draft.class) {
  const goldByClass = { barbarian:75,bard:125,cleric:125,druid:50,fighter:150,monk:12,paladin:150,ranger:150,rogue:100,sorcerer:75,warlock:100,wizard:100 };
  return goldByClass[cls] || 75;
}

// ── Spells ────────────────────────────────────────────────────────────────────
// Cantrips/spells known at level 1 per class (SRD classes.json has no spellcasting table)

/**
 * Final ability scores of the draft: base + race + subrace bonuses + a half-elf's two +1s. One function for
 * the review step and the saved character (the save used to drop subrace bonuses — audit A6).
 */
export function draftScores() { return scoresFor(CC.draft, SRD.races, SRD.backgrounds); }

/** A half-elf picks two abilities other than Charisma for +1 each. */
export function setHalfElfBonus(i, ability) {
  const pick = [...(CC.draft.halfElfBonus || ['', ''])];
  pick[i] = ability;
  CC.draft.halfElfBonus = pick;
  renderAbilityMethodUI();
}

/**
 * How many 1st-level spells a new (level 1) character takes. Clerics and druids prepare ability
 * modifier + level (min 1); paladins and rangers have no spells until level 2 (audit J2).
 */
export function spellLimitL1(classId) { return spellLimitFor(classId, draftScores().wis); }
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
  const spellLimit = spellLimitL1(cls.id);
  const isPrepared = cls.id === 'cleric' || cls.id === 'druid';

  el.innerHTML = `
    <div style="font-size:12px;color:var(--dnd-muted);margin-bottom:14px;line-height:1.5">
      Choose your starting spells for <strong style="color:var(--dnd-gold)">${esc(clsName)}</strong>.
      ${cantripLimit > 0 ? `Select <strong>${cantripLimit}</strong> cantrip${cantripLimit>1?'s':''}.` : ''}
      ${isPrepared ? `You prepare <strong>${spellLimit}</strong> spell${spellLimit>1?'s':''} (and can change them after a long rest).` :
        spellLimit > 0 ? `Select up to <strong>${spellLimit}</strong> 1st-level spell${spellLimit>1?'s':''}.` :
        `${esc(clsName)}s learn their first spells at level 2.`}
    </div>
    ${cantrips.length > 0 ? `
      <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
        Cantrips (${(CC.draft.cantrips||[]).length}/${cantripLimit > 0 ? cantripLimit : '∞'})
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px" id="cc-cantrip-list">
        ${cantrips.map(s => renderSpellRow(s, 'cantrip')).join('')}
      </div>
    ` : ''}
    ${level1Spells.length > 0 && spellLimit > 0 ? `
      <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
        1st-Level Spells (${(CC.draft.spells||[]).length}/${spellLimit})
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
        ${spell.desc ? `<div style="font-size:10px;color:var(--dnd-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(spell.desc.slice(0,80))}${spell.desc.length>80?'…':''}</div>` : ''}
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
    const spellLimit = spellLimitL1(cls?.id);
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

  const finalScores = draftScores();

  const profBonus = 2;
  const conMod = abilityMod(finalScores.con || 10);
  const hitDie = cls?.hit_die || 8;
  const maxHP = Math.max(1, hitDie + conMod) + (CC.draft.subrace === 'hill-dwarf' ? 1 : 0);
  const equipped = (CC.draft.equipment || []).filter(id => (SRD.equipment || []).find(e => e.id === id)?.category === 'Armor');
  const ac = armorClass({ class: CC.draft.class, ...finalScores }, equipped.filter((id, i, arr) => id === 'shield' || arr.findIndex(x => x !== 'shield') === i));
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
    // attachContext ties the portrait to the campaign so it is reclaimed with it
    // and never swept as an abandoned upload — plugin-storage spec §7.
    const result = await guarded(request)('files:upload', {
      data: buf, name: file.name, mime: file.type, maxSide: 1024, // a portrait: lk-upload.js shrinks it
      attachContext: `campaign:${CC.campaignId}`,
    });
    CC.draft.portraitUrl    = result.url;
    CC.draft.portraitFileId = result.id;
    const preview = document.getElementById('cc-portrait-preview');
    if (preview) preview.innerHTML = `<img src="${esc(result.url)}" style="width:100%;height:100%;object-fit:cover">`;
    if (btn) btn.textContent = '🔄 Change Portrait';
  } catch (err) {
    if (!err?.shown) alert('Portrait upload failed: ' + err.message);
    if (btn) btn.textContent = '📷 Upload Portrait';
  }
  input.value = '';
}
