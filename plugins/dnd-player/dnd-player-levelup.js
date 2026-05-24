// dnd-player-levelup.js — level-up wizard overlay
import { esc } from '../plugin-sdk.js';

// 5e XP thresholds — index = target level (1–20)
const XP_THRESHOLDS = [0,0,300,900,2700,6500,14000,23000,34000,48000,
  64000,85000,100000,120000,140000,165000,195000,225000,265000,305000,355000];

export function xpThreshold(level) { return XP_THRESHOLDS[Math.min(level, 20)] ?? Infinity; }
export function profBonusForLevel(level) { return Math.ceil(1 + level / 4); }

// ASI levels per class
const ASI_LEVELS = {
  fighter:  [4,6,8,12,14,16,19],
  rogue:    [4,8,10,12,16,18,19],
  default:  [4,8,12,16,19],
};
function isASILevel(cls, level) {
  const levels = ASI_LEVELS[cls?.toLowerCase()] || ASI_LEVELS.default;
  return levels.includes(level);
}

// Minimal class feature table (what you get at each level)
const CLASS_FEATURES = {
  barbarian: { 2:'Reckless Attack, Danger Sense', 3:'Primal Path', 4:'ASI', 5:'Extra Attack, Fast Movement', 7:'Feral Instinct', 9:'Brutal Critical', 11:'Relentless Rage', 15:'Persistent Rage', 20:'Primal Champion' },
  bard:      { 2:'Jack of All Trades, Song of Rest', 3:'Bard College, Expertise', 4:'ASI', 5:'Font of Inspiration', 6:'Countercharm', 10:'Magical Secrets', 20:'Superior Inspiration' },
  cleric:    { 2:'Channel Divinity (1/rest), Divine Domain feature', 4:'ASI', 5:'Destroy Undead', 6:'Channel Divinity (2/rest)', 8:'Divine Strike', 10:'Divine Intervention', 20:'Divine Intervention improvement' },
  druid:     { 2:'Wild Shape, Druid Circle', 4:'ASI, Wild Shape improvement', 5:'Wild Shape improvement', 6:'Druid Circle feature', 8:'ASI, Wild Shape improvement', 10:'Druid Circle feature', 20:'Beast Spells, Archdruid' },
  fighter:   { 2:'Action Surge', 3:'Martial Archetype', 4:'ASI', 5:'Extra Attack', 6:'ASI', 7:'Martial Archetype feature', 8:'ASI', 9:'Indomitable', 10:'Martial Archetype feature', 11:'Extra Attack (2)', 12:'ASI', 14:'ASI', 15:'Martial Archetype feature', 16:'ASI', 17:'Action Surge (2), Indomitable (3)', 18:'Martial Archetype feature', 19:'ASI', 20:'Extra Attack (3)' },
  monk:      { 2:'Ki, Unarmored Movement', 3:'Monastic Tradition, Deflect Missiles', 4:'ASI, Slow Fall', 5:'Extra Attack, Stunning Strike', 6:'Ki-Empowered Strikes, Monastic Tradition feature', 7:'Evasion, Stillness of Mind', 8:'ASI', 9:'Unarmored Movement improvement', 10:'Purity of Body', 11:'Monastic Tradition feature', 12:'ASI', 13:'Tongue of the Sun and Moon', 14:'Diamond Soul', 15:'Timeless Body', 16:'ASI', 17:'Monastic Tradition feature', 18:'Empty Body', 19:'ASI', 20:'Perfect Self' },
  paladin:   { 2:'Divine Smite, Fighting Style, Spellcasting', 3:'Divine Health, Sacred Oath', 4:'ASI', 5:'Extra Attack', 6:'Aura of Protection', 7:'Sacred Oath feature', 8:'ASI', 10:'Aura of Courage', 11:'Improved Divine Smite', 12:'ASI', 14:'Cleansing Touch', 15:'Sacred Oath feature', 16:'ASI', 18:'Aura improvements', 19:'ASI', 20:'Sacred Oath feature' },
  ranger:    { 2:'Fighting Style, Spellcasting, Favored Enemy, Natural Explorer', 3:'Ranger Archetype, Primeval Awareness', 4:'ASI', 5:'Extra Attack', 6:'Favored Enemy improvement', 7:'Ranger Archetype feature', 8:'ASI, Land\'s Stride', 10:'Natural Explorer improvement, Hide in Plain Sight', 11:'Ranger Archetype feature', 12:'ASI', 14:'Vanish, Favored Enemy improvement', 15:'Ranger Archetype feature', 16:'ASI', 18:'Feral Senses', 19:'ASI', 20:'Foe Slayer' },
  rogue:     { 2:'Cunning Action', 3:'Roguish Archetype', 4:'ASI', 5:'Uncanny Dodge', 6:'Expertise', 7:'Evasion', 8:'ASI', 9:'Roguish Archetype feature', 10:'ASI', 11:'Reliable Talent', 12:'ASI', 13:'Roguish Archetype feature', 14:'Blindsense', 15:'Slippery Mind', 16:'ASI', 17:'Roguish Archetype feature', 18:'Elusive', 19:'ASI', 20:'Stroke of Luck' },
  sorcerer:  { 2:'Font of Magic', 3:'Metamagic', 4:'ASI', 5:'Metamagic', 8:'ASI', 10:'Metamagic', 12:'ASI', 15:'Metamagic', 16:'ASI', 19:'ASI', 20:'Sorcerous Restoration' },
  warlock:   { 2:'Eldritch Invocations', 3:'Pact Boon', 4:'ASI', 5:'Eldritch Invocations', 8:'ASI', 11:'Mystic Arcanum (6th)', 12:'ASI', 13:'Mystic Arcanum (7th)', 15:'Mystic Arcanum (8th)', 16:'ASI', 17:'Mystic Arcanum (9th)', 19:'ASI', 20:'Eldritch Master' },
  wizard:    { 2:'Arcane Tradition', 4:'ASI', 5:'Arcane Tradition feature', 6:'Arcane Tradition feature', 8:'ASI', 10:'Arcane Tradition feature', 12:'ASI', 14:'Arcane Tradition feature', 16:'ASI', 18:'Spell Mastery', 19:'ASI', 20:'Signature Spells' },
};

// Spell slot table [level_1_slots, level_2_slots, ...] per character level for full casters
const SPELL_SLOTS_FULL = [
  null,                                    // level 0 (unused)
  [2,0,0,0,0,0,0,0,0],                   // level 1
  [3,0,0,0,0,0,0,0,0],                   // level 2
  [4,2,0,0,0,0,0,0,0],                   // level 3
  [4,3,0,0,0,0,0,0,0],                   // level 4
  [4,3,2,0,0,0,0,0,0],                   // level 5
  [4,3,3,0,0,0,0,0,0],                   // level 6
  [4,3,3,1,0,0,0,0,0],                   // level 7
  [4,3,3,2,0,0,0,0,0],                   // level 8
  [4,3,3,3,1,0,0,0,0],                   // level 9
  [4,3,3,3,2,0,0,0,0],                   // level 10
  [4,3,3,3,2,1,0,0,0],                   // level 11
  [4,3,3,3,2,1,0,0,0],                   // level 12
  [4,3,3,3,2,1,1,0,0],                   // level 13
  [4,3,3,3,2,1,1,0,0],                   // level 14
  [4,3,3,3,2,1,1,1,0],                   // level 15
  [4,3,3,3,2,1,1,1,0],                   // level 16
  [4,3,3,3,2,1,1,1,1],                   // level 17
  [4,3,3,3,3,1,1,1,1],                   // level 18
  [4,3,3,3,3,2,1,1,1],                   // level 19
  [4,3,3,3,3,2,2,1,1],                   // level 20
];

const FULL_CASTERS = ['bard','cleric','druid','sorcerer','wizard'];
const HALF_CASTERS = ['paladin','ranger'];

function getSpellSlots(cls, level) {
  if (FULL_CASTERS.includes(cls?.toLowerCase())) {
    const row = SPELL_SLOTS_FULL[Math.min(level, 20)];
    return row ? row.map((n, i) => [n, n]) : null;
  }
  if (HALF_CASTERS.includes(cls?.toLowerCase())) {
    const hLevel = Math.floor(level / 2);
    const row = SPELL_SLOTS_FULL[Math.min(hLevel, 20)];
    return row ? row.map((n, i) => [n, n]) : null;
  }
  return null; // non-caster
}

// ── Wizard state ──────────────────────────────────────────────────────────────

let _char = null;
let _saveChar = null;
let _campaignId = null;
let _userId = null;
let _srdData = null;  // { classes, feats, spells }

let _draft = null;
let _step  = 0;

const STEPS = ['Confirm', 'Hit Points', 'Features', 'Spells', 'ASI / Feat', 'Done'];

// ── Entry point ───────────────────────────────────────────────────────────────

export async function startLevelUp(char, saveCharFn, campaignId, userId, srdData) {
  _char = char;
  _saveChar = saveCharFn;
  _campaignId = campaignId;
  _userId = userId;
  _srdData = srdData || {};

  const newLevel = (_char.level || 1) + 1;
  _draft = {
    newLevel,
    hpGained:    null,
    spellsChosen: [],
    featChosen:   null,
    asiChoice:    null,
  };
  _step = 0;

  _buildStepList(newLevel, char.class);
  _renderOverlay();
}

let _activeSteps = [];

function _buildStepList(newLevel, cls) {
  const featureText = (CLASS_FEATURES[cls?.toLowerCase()] || {})[newLevel];
  const slots       = getSpellSlots(cls, newLevel);
  const hasASI      = isASILevel(cls, newLevel);

  _activeSteps = ['confirm', 'hp'];
  if (featureText)  _activeSteps.push('features');
  if (slots)        _activeSteps.push('spells');
  if (hasASI)       _activeSteps.push('asi');
  _activeSteps.push('done');
}

function _renderOverlay() {
  document.getElementById('levelup-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'levelup-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:500;background:var(--bg, #0f0e17);' +
    'display:flex;flex-direction:column;overflow:hidden';

  const stepName = _activeSteps[_step];
  const total    = _activeSteps.length;
  const pct      = Math.round((_step / (total - 1)) * 100);

  overlay.innerHTML =
    `<div style="padding:14px 16px;border-bottom:1px solid rgba(212,175,55,.2);flex-shrink:0">` +
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">` +
        `<div style="font-size:13px;font-weight:800;color:#d4af37">⬆ Level Up — ${_char.name}</div>` +
        `<div onclick="closeLevelUp()" style="cursor:pointer;color:rgba(255,255,255,.4);font-size:16px;line-height:1">✕</div>` +
      `</div>` +
      `<div style="height:3px;background:rgba(255,255,255,.1);border-radius:2px;margin-bottom:6px">` +
        `<div style="height:100%;width:${pct}%;background:#d4af37;border-radius:2px;transition:width .3s"></div>` +
      `</div>` +
      `<div style="font-size:10px;color:rgba(255,255,255,.4)">Step ${_step+1} of ${total}</div>` +
    `</div>` +
    `<div id="levelup-content" style="flex:1;overflow-y:auto;padding:16px"></div>` +
    `<div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:8px;flex-shrink:0">` +
      `<button onclick="levelUpBack()" ${_step===0?'disabled':''} ` +
        `style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);` +
        `border-radius:6px;color:rgba(255,255,255,.6);font-size:12px;cursor:pointer">← Back</button>` +
      `<button onclick="levelUpNext()" ` +
        `style="flex:1;padding:8px;background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);` +
        `border-radius:6px;color:#d4af37;font-size:12px;font-weight:700;cursor:pointer" id="levelup-next-btn">` +
        `${stepName === 'done' ? 'Apply Level Up ✨' : 'Next →'}</button>` +
    `</div>`;

  document.getElementById('app')?.appendChild(overlay);
  _renderStep(stepName);
}

function _renderStep(stepName) {
  const el = document.getElementById('levelup-content');
  if (!el) return;
  if (stepName === 'confirm')  _stepConfirm(el);
  else if (stepName === 'hp')       _stepHP(el);
  else if (stepName === 'features') _stepFeatures(el);
  else if (stepName === 'spells')   _stepSpells(el);
  else if (stepName === 'asi')      _stepASI(el);
  else if (stepName === 'done')     _stepDone(el);
}

// ── Step renderers ────────────────────────────────────────────────────────────

function _stepConfirm(el) {
  const newLevel = _draft.newLevel;
  const featureText = (CLASS_FEATURES[_char.class?.toLowerCase()] || {})[newLevel] || 'No special features at this level.';
  el.innerHTML =
    `<div style="text-align:center;margin-bottom:20px">` +
      `<div style="font-size:48px;margin-bottom:8px">⬆</div>` +
      `<div style="font-size:22px;font-weight:900;color:#d4af37">Level ${newLevel}!</div>` +
      `<div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:4px">` +
        `${_char.name} — ${_char.race} ${_char.class}</div>` +
    `</div>` +
    `<div style="background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.2);border-radius:8px;padding:14px">` +
      `<div style="font-size:11px;font-weight:700;color:#d4af37;margin-bottom:8px">New Features at Level ${newLevel}</div>` +
      `<div style="font-size:12px;color:rgba(255,255,255,.8);line-height:1.6">${esc(featureText)}</div>` +
    `</div>`;
}

function _stepHP(el) {
  const cls = (_srdData.classes || []).find(c => c.id === _char.class?.toLowerCase());
  const hd = cls?.hit_die || 8;
  const avg = Math.ceil(hd / 2) + 1;
  const conMod = Math.floor((((_char.con ?? 10) - 10) / 2));
  const modStr = conMod >= 0 ? `+${conMod}` : `${conMod}`;

  el.innerHTML =
    `<div style="text-align:center;margin-bottom:20px">` +
      `<div style="font-size:36px;margin-bottom:8px">❤️</div>` +
      `<div style="font-size:16px;font-weight:700;color:#d4af37">Hit Points</div>` +
      `<div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:4px">` +
        `Hit Die: d${hd} · CON modifier: ${modStr}</div>` +
    `</div>` +
    (_draft.hpGained !== null
      ? `<div style="text-align:center;padding:16px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;margin-bottom:14px">` +
          `<div style="font-size:32px;font-weight:900;color:#22c55e">+${_draft.hpGained}</div>` +
          `<div style="font-size:11px;color:rgba(255,255,255,.5)">HP gained</div>` +
        `</div>`
      : '') +
    `<div style="display:flex;flex-direction:column;gap:10px">` +
      `<button onclick="levelUpRollHP(${hd},${conMod})" ` +
        `style="padding:14px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.4);` +
        `border-radius:8px;color:#d4af37;font-size:13px;font-weight:700;cursor:pointer;text-align:left">` +
        `🎲 Roll d${hd} (random)<br><span style="font-size:10px;font-weight:400;color:rgba(255,255,255,.4)">` +
        `1-${hd} ${modStr} CON</span></button>` +
      `<button onclick="levelUpTakeAverage(${avg},${conMod})" ` +
        `style="padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);` +
        `border-radius:8px;color:rgba(255,255,255,.8);font-size:13px;font-weight:700;cursor:pointer;text-align:left">` +
        `📊 Take Average (+${avg + conMod})<br><span style="font-size:10px;font-weight:400;color:rgba(255,255,255,.4)">` +
        `${avg} ${modStr} CON = +${avg + conMod} HP</span></button>` +
    `</div>`;
}

function _stepFeatures(el) {
  const newLevel = _draft.newLevel;
  const featureText = (CLASS_FEATURES[_char.class?.toLowerCase()] || {})[newLevel] || '';
  el.innerHTML =
    `<div style="font-size:14px;font-weight:700;color:#d4af37;margin-bottom:16px">✨ Level ${newLevel} Features</div>` +
    featureText.split(',').map(f => f.trim()).filter(Boolean).map(f =>
      `<div style="padding:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);` +
        `border-left:3px solid #d4af37;border-radius:6px;margin-bottom:8px">` +
        `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.9)">${esc(f)}</div>` +
      `</div>`
    ).join('') ||
    `<div style="color:rgba(255,255,255,.5);font-size:12px">Consult your Player's Handbook for level ${newLevel} features.</div>`;
}

function _stepSpells(el) {
  const cls = _char.class?.toLowerCase();
  const newLevel = _draft.newLevel;
  const newSlots = getSpellSlots(cls, newLevel);

  const allSpells = (_srdData.spells || []).filter(sp => {
    const spClasses = (sp.classes || []).map(c => c.toLowerCase());
    return spClasses.includes(cls) || spClasses.includes(_char.class);
  });
  const maxSpellLevel = newSlots ? newSlots.findLastIndex(([n]) => n > 0) + 1 : 0;
  const castable = allSpells.filter(sp => sp.level <= maxSpellLevel && !(_char.spells||[]).includes(sp.id));

  el.innerHTML =
    `<div style="font-size:14px;font-weight:700;color:#d4af37;margin-bottom:10px">📖 Spells</div>` +
    `<div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:14px">` +
      `New spell slots at level ${newLevel}. Select any new spells to add to your list (optional).</div>` +
    (castable.length
      ? `<div style="display:flex;flex-direction:column;gap:4px">` +
          castable.slice(0, 50).map(sp =>
            `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;` +
              `background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:6px;cursor:pointer">` +
              `<input type="checkbox" value="${esc(sp.id)}" onchange="levelUpToggleSpell(this)" ` +
                `${_draft.spellsChosen.includes(sp.id)?'checked':''}>` +
              `<span style="font-size:11px;color:rgba(255,255,255,.85)">${esc(sp.name)}</span>` +
              `<span style="font-size:10px;color:rgba(255,255,255,.3);margin-left:auto">Lv ${sp.level} · ${esc(sp.school)}</span>` +
            `</label>`
          ).join('') +
        `</div>`
      : `<div style="color:rgba(255,255,255,.4);font-size:12px">No additional spells available to add from SRD at this level.</div>`
    );
}

function _stepASI(el) {
  const ABILITY_LABELS = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };
  const ABILITIES = ['str','dex','con','int','wis','cha'];
  const feats = _srdData.feats || [];

  el.innerHTML =
    `<div style="font-size:14px;font-weight:700;color:#d4af37;margin-bottom:14px">⭐ Ability Score Improvement</div>` +
    `<div style="display:flex;flex-direction:column;gap:10px">` +
      `<label style="display:flex;align-items:center;gap:8px;padding:12px;background:rgba(255,255,255,.04);` +
        `border:1px solid rgba(255,255,255,.15);border-radius:8px;cursor:pointer">` +
        `<input type="radio" name="asi-choice" value="double" onchange="levelUpASIMode(this)" ` +
          `${!_draft.featChosen ? 'checked' : ''}>` +
        `<div>` +
          `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.9)">+2 to one ability</div>` +
          `<select id="asi-double-select" style="margin-top:6px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);` +
            `border-radius:4px;padding:4px 6px;color:#fff;font-size:11px">` +
            ABILITIES.map(a => `<option value="${a}" ${_char[a]>=20?'disabled':''}>` +
              `${ABILITY_LABELS[a]} (${_char[a]??10})${_char[a]>=20?' — max':''}</option>`).join('') +
          `</select>` +
        `</div>` +
      `</label>` +
      `<label style="display:flex;align-items:center;gap:8px;padding:12px;background:rgba(255,255,255,.04);` +
        `border:1px solid rgba(255,255,255,.15);border-radius:8px;cursor:pointer">` +
        `<input type="radio" name="asi-choice" value="split" onchange="levelUpASIMode(this)">` +
        `<div>` +
          `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.9)">+1 to two abilities</div>` +
          `<div style="display:flex;gap:6px;margin-top:6px">` +
            `<select id="asi-split-a1" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:4px 6px;color:#fff;font-size:11px">` +
              ABILITIES.map(a => `<option value="${a}">${ABILITY_LABELS[a]} (${_char[a]??10})</option>`).join('') +
            `</select>` +
            `<select id="asi-split-a2" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:4px 6px;color:#fff;font-size:11px">` +
              ABILITIES.map(a => `<option value="${a}">${ABILITY_LABELS[a]} (${_char[a]??10})</option>`).join('') +
            `</select>` +
          `</div>` +
        `</div>` +
      `</label>` +
      (feats.length
        ? `<label style="display:flex;align-items:flex-start;gap:8px;padding:12px;background:rgba(255,255,255,.04);` +
            `border:1px solid rgba(255,255,255,.15);border-radius:8px;cursor:pointer">` +
            `<input type="radio" name="asi-choice" value="feat" onchange="levelUpASIMode(this)" ` +
              `${_draft.featChosen ? 'checked' : ''}>` +
            `<div style="flex:1">` +
              `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.9)">Choose a Feat</div>` +
              `<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">` +
                feats.map(f =>
                  `<label style="display:flex;align-items:flex-start;gap:6px;padding:6px;background:rgba(0,0,0,.2);border-radius:4px;cursor:pointer">` +
                    `<input type="radio" name="feat-choice" value="${esc(f.id)}" onchange="levelUpFeat(this)" ` +
                      `${_draft.featChosen===f.id?'checked':''}>` +
                    `<div>` +
                      `<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.85)">${esc(f.name)}</div>` +
                      `<div style="font-size:10px;color:rgba(255,255,255,.4);line-height:1.4">${esc((f.desc||'').slice(0,120))}${(f.desc||'').length>120?'…':''}</div>` +
                    `</div>` +
                  `</label>`
                ).join('') +
              `</div>` +
            `</div>` +
          `</label>`
        : ''
      ) +
    `</div>`;
}

function _stepDone(el) {
  const newSlots = getSpellSlots(_char.class, _draft.newLevel);
  el.innerHTML =
    `<div style="text-align:center;margin-bottom:20px">` +
      `<div style="font-size:48px;margin-bottom:8px">🎉</div>` +
      `<div style="font-size:18px;font-weight:800;color:#d4af37">Ready!</div>` +
    `</div>` +
    `<div style="display:flex;flex-direction:column;gap:8px;font-size:12px">` +
      `<div style="padding:10px;background:rgba(255,255,255,.04);border-radius:6px">` +
        `<strong>Level:</strong> ${_char.level} → ${_draft.newLevel}</div>` +
      `<div style="padding:10px;background:rgba(255,255,255,.04);border-radius:6px">` +
        `<strong>HP:</strong> +${_draft.hpGained ?? 0} (new max: ${(_char.hpMax||0) + (_draft.hpGained||0)})</div>` +
      (_draft.asiChoice
        ? `<div style="padding:10px;background:rgba(255,255,255,.04);border-radius:6px">` +
            `<strong>ASI:</strong> ${_formatASI(_draft.asiChoice)}</div>`
        : '') +
      (_draft.featChosen
        ? `<div style="padding:10px;background:rgba(255,255,255,.04);border-radius:6px">` +
            `<strong>Feat:</strong> ${esc(_draft.featChosen)}</div>`
        : '') +
      (_draft.spellsChosen.length
        ? `<div style="padding:10px;background:rgba(255,255,255,.04);border-radius:6px">` +
            `<strong>New spells:</strong> ${_draft.spellsChosen.join(', ')}</div>`
        : '') +
    `</div>`;
}

function _formatASI(asiChoice) {
  if (!asiChoice) return '';
  if (asiChoice.type === 'double') return `+2 ${asiChoice.ability1}`;
  if (asiChoice.type === 'split') return `+1 ${asiChoice.ability1}, +1 ${asiChoice.ability2}`;
  return '';
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function levelUpBack() {
  if (_step > 0) { _step--; _renderOverlay(); }
}

export function levelUpNext() {
  const stepName = _activeSteps[_step];
  if (stepName === 'hp' && _draft.hpGained === null) { alert('Please choose how to gain HP.'); return; }
  if (stepName === 'done') { applyLevelUp(); return; }
  _step++;
  _renderOverlay();
}

export function closeLevelUp() {
  document.getElementById('levelup-overlay')?.remove();
  _draft = null;
}

// ── Step callbacks ────────────────────────────────────────────────────────────

export function levelUpRollHP(hd, conMod) {
  const rolled = Math.ceil(Math.random() * hd);
  _draft.hpGained = Math.max(1, rolled + conMod);
  _renderStep('hp');
}

export function levelUpTakeAverage(avg, conMod) {
  _draft.hpGained = Math.max(1, avg + conMod);
  _renderStep('hp');
}

export function levelUpToggleSpell(input) {
  const id = input.value;
  if (input.checked) { if (!_draft.spellsChosen.includes(id)) _draft.spellsChosen.push(id); }
  else { _draft.spellsChosen = _draft.spellsChosen.filter(s => s !== id); }
}

export function levelUpASIMode(input) {
  const val = input.value;
  if (val === 'feat') { _draft.asiChoice = null; }
  else if (val === 'double') {
    _draft.featChosen = null;
    const sel = document.getElementById('asi-double-select');
    _draft.asiChoice = { type: 'double', ability1: sel?.value || 'str' };
  } else if (val === 'split') {
    _draft.featChosen = null;
    const a1 = document.getElementById('asi-split-a1')?.value || 'str';
    const a2 = document.getElementById('asi-split-a2')?.value || 'dex';
    _draft.asiChoice = { type: 'split', ability1: a1, ability2: a2 };
  }
}

export function levelUpFeat(input) {
  _draft.featChosen = input.value;
  _draft.asiChoice  = null;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export async function applyLevelUp() {
  if (!_char || !_saveChar) return;

  _char.level = _draft.newLevel;
  _char.hpMax = (_char.hpMax || 0) + (_draft.hpGained || 0);
  _char.hp    = Math.min(_char.hp ?? _char.hpMax, _char.hpMax);
  _char.proficiencyBonus = profBonusForLevel(_char.level);

  // ASI
  if (_draft.asiChoice?.type === 'double' && _draft.asiChoice.ability1) {
    const ab = _draft.asiChoice.ability1;
    _char[ab] = Math.min(20, (_char[ab] ?? 10) + 2);
  } else if (_draft.asiChoice?.type === 'split') {
    const a1 = _draft.asiChoice.ability1, a2 = _draft.asiChoice.ability2;
    if (a1) _char[a1] = Math.min(20, (_char[a1] ?? 10) + 1);
    if (a2 && a2 !== a1) _char[a2] = Math.min(20, (_char[a2] ?? 10) + 1);
  }

  // Feat
  if (_draft.featChosen) {
    if (!_char.features) _char.features = [];
    _char.features.push(_draft.featChosen);
  }

  // New spells
  if (_draft.spellsChosen.length) {
    _char.spells = [...(_char.spells || []), ..._draft.spellsChosen];
  }

  // Update spell slots to new level
  const newSlots = getSpellSlots(_char.class, _char.level);
  if (newSlots) {
    const oldSlots = _char.spellSlots || [];
    _char.spellSlots = newSlots.map(([, max], i) => {
      const oldCur = oldSlots[i]?.[0] ?? max;
      return [Math.min(oldCur, max), max];
    });
  }

  await _saveChar();

  // Broadcast HP change so the hub token updates
  try {
    const { realtimePublish } = await import('../../plugin-sdk.js');
    const { EV } = await import('../../dnd-hub/dnd-hub-event-types.js');
    await realtimePublish(EV.HP_CHANGE, {
      type: EV.HP_CHANGE, userId: _userId, campaignId: _campaignId,
      hp: _char.hp, hpMax: _char.hpMax, source: `Level up to ${_char.level}`,
    });
  } catch { /* non-critical */ }

  closeLevelUp();
  if (typeof window.renderAll === 'function') window.renderAll();
}
