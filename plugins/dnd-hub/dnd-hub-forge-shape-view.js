// dnd-hub-forge-shape-view.js — the Hero Forge's guided steps (markup only; dnd-hub-forge.js owns the state).
// Same look as the level-up scene: a hero header, a grid of cards, Back / Next. Every step opens with a choice already
// made (Quick character's suggestion) and says why it matters, for players new to the game.
import { esc } from '../plugin-sdk.js';
import { emblem } from './dnd-hub-emblems.js';
import { abilityMod } from './lk-rules5e.js';
import { icon } from './lk-icons.js';

export const SHAPE_TITLES = { heritage: 'Your heritage', abilities: 'Your abilities', skills: 'Your skills',
  background: 'Your past', gear: 'Your gear', spells: 'Your magic', details: 'Who you are' };
const ABILITIES = [
  ['str', 'Strength', 'Hitting hard, lifting, climbing'], ['dex', 'Dexterity', 'Aim, dodging, sneaking'],
  ['con', 'Constitution', 'Hit points and staying power'], ['int', 'Intelligence', 'Knowledge, wizard magic'],
  ['wis', 'Wisdom', 'Noticing things, cleric and druid magic'], ['cha', 'Charisma', 'Persuasion, bard and warlock magic'],
];
const ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'];
const fmt = n => (n >= 0 ? '+' : '') + n;
const card = (fn, id, name, desc, on) =>
  `<button class="lvl-card" aria-pressed="${!!on}" onclick="${fn}('${esc(id)}')"><b>${esc(name)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</button>`;
const note = t => `<div class="lvl-note">${t}</div>`;

export function shapeHeader(draft, race, cls, i, n, kind, muted) {
  return `<div class="forge-top">
      <button class="screen-back" onclick="shapeBack()" aria-label="Back">${icon('arrow-left')}</button>
      <div class="forge-title">${esc(SHAPE_TITLES[kind] || '')}</div>
      <div style="margin-left:auto;color:var(--lk-muted);font-size:12px">Step ${i + 1} of ${n}</div>
      <button class="btn btn-ghost btn-sm" onclick="forgeToggleMute()" aria-pressed="${muted}" aria-label="${muted ? 'Sound off' : 'Sound on'}">${icon(muted ? 'volume-x' : 'volume-2')}</button>
    </div>
    <div class="forge-dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>
    <div class="lvl-hero"><span style="color:${race.colour}">${emblem(race.emblem, 54)}</span>${emblem(cls.emblem, 54)}
      <div><div class="forge-name" style="font-size:26px">${esc(draft.name || 'Your hero')}</div>
      <div style="color:var(--lk-muted)">${esc(race.name)} ${esc(cls.name)}</div></div></div>`;
}

/** `ctx`: { srd, race (SRD race), cls (classView), skills (skillStep), spells (spellStep), kit (names), gold, finals } */
export function shapeBody(kind, d, ctx) {
  switch (kind) {
    case 'heritage':
      return note(`${esc(ctx.race.name)}s come from different lands. Each heritage adds its own gifts.`)
        + `<div class="lvl-grid">${ctx.race.subraces.map(s => card('shapePick', 'subrace:' + s.id, s.name, (s.desc || '').slice(0, 160), d.subrace === s.id)).join('')}</div>`;
    case 'abilities': {
      const values = Object.values(d.baseScores).sort((a, b) => b - a);
      const rows = ABILITIES.map(([k, name, what]) => {
        const main = ctx.main.includes(k);
        return `<div class="lvl-ab"><span style="flex:1"><b>${name}</b>${main ? ' <span style="color:var(--lk-gold)" title="Important for your class">★</span>' : ''}<br><small style="color:var(--lk-muted)">${what}</small></span>
          <select aria-label="${name} score" onchange="shapeScore('${k}', this.value)">${values.map((v, i) =>
            `<option value="${v}" ${d.baseScores[k] === v && values.indexOf(v) === i ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <b style="min-width:70px;text-align:right">${ctx.finals[k]} <small style="color:var(--lk-gold)">(${fmt(abilityMod(ctx.finals[k]))})</small></b></div>`;
      }).join('');
      return note(`Six numbers say what your hero is good at. We put the best ones where a ${esc(ctx.cls.name)} needs them (★). Change a number and the two swap. Your heritage's bonus is already added on the right.`)
        + `<div class="lvl-abs">${rows}</div>`
        + `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="shapeScores('array')" aria-pressed="${d.abilityMethod === 'standard-array'}">Standard numbers (15, 14, 13, 12, 10, 8)</button>
            <button class="btn btn-ghost btn-sm" onclick="shapeScores('roll')" aria-pressed="${d.abilityMethod === 'manual-roll'}">🎲 Roll for them</button></div>`
        + (d.race === 'half-elf' ? note('Half-elf: +2 Charisma, and +1 to two other abilities:') + `<div style="display:flex;gap:8px">${[0, 1].map(i =>
          `<select aria-label="Half-elf bonus ${i + 1}" onchange="shapeHalfElf(${i}, this.value)">${ABILITIES.filter(([k]) => k !== 'cha').map(([k, name]) =>
            `<option value="${k}" ${(d.halfElfBonus || [])[i] === k ? 'selected' : ''}>${name}</option>`).join('')}</select>`).join('')}</div>` : '');
    }
    case 'skills': {
      const s = ctx.skills, picked = d.proficiencyChoices || [], extra = d.extraSkills || [];
      return note(`Skills are what you are trained in: when you try one, you add a bonus. Choose ${s.choose} (${picked.length}/${s.choose}).`
          + (s.already.length ? ` Already yours from your people and past: <b>${s.already.map(esc).join(', ')}</b>.` : ''))
        + `<div class="lvl-grid">${s.from.map(n => card('shapeSkill', n, n, '', picked.includes(n))).join('')}</div>`
        + (s.halfElf ? note(`Half-elf: two more skills of any kind (${extra.length}/2).`)
          + `<div class="lvl-grid">${ctx.allSkills.filter(n => !picked.includes(n) && !s.already.includes(n)).map(n => card('shapeExtraSkill', n, n, '', extra.includes(n))).join('')}</div>` : '');
    }
    case 'background':
      return note('Where your hero comes from: it gives skills and a feature.')
        + `<div class="lvl-grid">${(ctx.srd.backgrounds || []).map(b => card('shapePick', 'background:' + b.id, b.name, b.feature?.name || '', d.background === b.id)).join('')}</div>`;
    case 'gear':
      return note('What you carry into your first adventure. Armour you take is worn and weapons are ready.')
        + `<div class="lvl-grid">
          ${card('shapePick', 'gear:kit', `The ${ctx.cls.name}'s gear`, 'Your class\'s starting equipment, with a choice at each step.', !d.useStartingGold)}
          ${card('shapePick', 'gear:gold', `${ctx.gold} gold instead`, 'Buy your own now; what you do not spend you keep.', d.useStartingGold)}</div>
        <div style="margin-top:14px">${ctx.gearHtml || ''}</div>`;
    case 'spells': {
      const sp = ctx.spells, c = d.cantrips || [], s = d.spells || [];
      const desc = x => (x.desc || '').replace(/\s+/g, ' ').slice(0, 110) + ((x.desc || '').length > 110 ? '…' : '');
      return (sp.cantrips ? note(`Cantrips are small spells you can cast as often as you like. Choose ${sp.cantrips} (${c.length}/${sp.cantrips}).`)
          + `<div class="lvl-grid">${sp.options.cantrips.map(x => card('shapeCantrip', x.id, x.name, desc(x), c.includes(x.id))).join('')}</div>` : '')
        + (sp.spells ? note(`${sp.prepared ? 'Spells you have prepared' : '1st-level spells'}: each uses a spell slot. Choose ${sp.spells} (${s.length}/${sp.spells}).${sp.prepared ? ' You can change them after a long rest.' : ''}`)
          + `<div class="lvl-grid">${sp.options.spells.map(x => card('shapeSpell', x.id, x.name, desc(x), s.includes(x.id))).join('')}</div>` : '');
    }
    case 'details':
      return `<div style="display:grid;gap:12px;max-width:620px">
        <label class="lvl-note" style="margin:0">Name
          <div style="display:flex;gap:8px;margin-top:4px"><input id="shape-name" value="${esc(d.name || '')}" maxlength="60" oninput="shapeText('name', this.value)" style="flex:1;font-family:var(--lk-title);font-size:20px">
          <button class="btn btn-ghost btn-sm" onclick="shapeNewName()" title="Suggest another name">🎲</button></div></label>
        <label class="lvl-note" style="margin:0">How they act (alignment)
          <select onchange="shapeText('alignment', this.value)" style="display:block;margin-top:4px">${ALIGNMENTS.map(a => `<option ${d.alignment === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="lvl-note" style="margin:0">A trait people notice (optional)
          <input value="${esc(d.personalityTraits || '')}" maxlength="300" oninput="shapeText('personalityTraits', this.value)" placeholder="Always hums while sharpening a blade" style="display:block;width:100%;margin-top:4px"></label>
        <label class="lvl-note" style="margin:0">Their story so far (optional)
          <textarea rows="3" maxlength="1000" oninput="shapeText('backstory', this.value)" placeholder="Where do they come from? Why adventure?" style="display:block;width:100%;margin-top:4px">${esc(d.backstory || '')}</textarea></label>
        <div style="display:flex;align-items:center;gap:10px">
          <div id="cc-portrait-preview" style="width:56px;height:56px;border-radius:50%;overflow:hidden;border:1px solid var(--lk-line);display:flex;align-items:center;justify-content:center">${d.portraitUrl ? `<img src="${esc(d.portraitUrl)}" style="width:100%;height:100%;object-fit:cover">` : ''}</div>
          <button class="btn btn-ghost btn-sm" onclick="triggerPortraitUpload()">${d.portraitUrl ? 'Change portrait' : 'Add a portrait (optional)'}</button>
          <input type="file" id="cc-portrait-input" accept="image/*" style="display:none" onchange="handlePortraitUpload(this)"></div>
      </div>`;
    default: return '';
  }
}

export function shapeFooter(error, isLast) {
  return `<div class="lvl-foot"><div class="lvl-error" role="alert">${esc(error || '')}</div>
    ${isLast ? '' : '<button class="btn btn-ghost btn-sm" id="shape-finish" onclick="shapeFinish()">Use the suggestions for the rest</button>'}
    <button class="btn btn-ghost" onclick="shapeBack()">Back</button>
    <button class="btn btn-gold" id="shape-next" onclick="shapeNext()">${isLast ? 'See my hero' : 'Next'}</button></div>`;
}
