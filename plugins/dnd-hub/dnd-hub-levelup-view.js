// dnd-hub-levelup-view.js — the level-up scene's screens (strings only; dnd-hub-levelup.js owns state).
import { esc } from '../plugin-sdk.js';
import { emblem } from './dnd-hub-emblems.js';

const TITLES = { hp: 'Hit points', subclass: 'Choose your path', fightingStyle: 'Fighting style', expertise: 'Expertise',
  pactBoon: 'Pact boon', invocations: 'Eldritch invocations', metamagic: 'Metamagic', asi: 'Grow stronger',
  spells: 'New magic', features: 'What you gain' };
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

const card = (id, name, desc, on, group, multi) =>
  `<button class="lvl-card" aria-pressed="${on}" onclick="levelupPick('${group}','${esc(id)}',${multi})"><b>${esc(name)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</button>`;

export function header(hero, raceView, classView, level, stepIndex, stepCount, kind) {
  return `<div class="forge-top"><div class="forge-title">${level === 1 ? '' : `Level ${level} · `}${esc(TITLES[kind] || '')}</div>
    <div style="margin-left:auto;color:var(--lk-muted);font-size:12px">${stepIndex + 1} / ${stepCount}</div></div>
    <div class="lvl-hero"><span style="color:${raceView.colour}">${emblem(raceView.emblem, 54)}</span>${emblem(classView.emblem, 54)}
      <div><div class="forge-name" style="font-size:26px">${esc(hero.name)}</div><div style="color:var(--lk-muted)">${level === 1 ? `${esc(classView.name)} · your first choices` : `${esc(classView.name)} ${level - 1} → ${level}`}</div></div></div>`;
}

export function body(step, choice, hero) {
  switch (step.kind) {
    case 'hp': return `<div class="lvl-grid">
      ${card('average', `Take ${Math.max(1, step.average + step.conMod) + (step.hillDwarf ? 1 : 0)} (average)`, `d${step.die} average ${step.average} + CON ${step.conMod >= 0 ? '+' : ''}${step.conMod}${step.hillDwarf ? ' + 1 (hill dwarf)' : ''}`, choice?.mode === 'average', 'hp', false)}
      <div class="lvl-card ${choice?.mode === 'roll' ? 'on' : ''}"><b>Roll a d${step.die}</b>
        <span>Roll it at the table or here, then CON ${step.conMod >= 0 ? '+' : ''}${step.conMod}${step.hillDwarf ? ' and 1 (hill dwarf) are' : ' is'} added.</span>
        <div style="display:flex;gap:6px;margin-top:6px"><input id="lvl-roll" type="number" min="1" max="${step.die}" value="${choice?.roll ?? ''}" style="width:70px" oninput="levelupRoll(this.value)">
        <button class="btn btn-ghost btn-sm" onclick="levelupRollDie(${step.die})">Roll</button></div></div></div>`;
    case 'subclass': case 'fightingStyle': case 'pactBoon':
      return `<div class="lvl-grid">${step.options.map(o => card(o.id, o.name + (o.homebrew ? ' ✦' : ''), [o.desc, o.levels].filter(Boolean).join(' — '), choice === o.id, step.kind, false)).join('')}</div>`
        + (step.options.some(o => o.homebrew) ? '<div class="lvl-note">✦ added by your DM: its numbers are applied by hand.</div>' : '');
    case 'expertise':
      return `<div class="lvl-note">Choose ${step.count}: you add double your proficiency bonus.</div><div class="lvl-grid">${step.options.map(s => card(s, s, '', (choice || []).includes(s), 'expertise', true)).join('')}</div>`;
    case 'invocations': case 'metamagic':
      return `<div class="lvl-note">Choose ${step.count}.</div><div class="lvl-grid">${step.options.map(o => card(o.id, o.name, o.desc, (choice || []).includes(o.id), step.kind, true)).join('')}</div>`;
    case 'asi': {
      const plus = choice?.kind === 'asi' ? choice.plus || {} : {};
      const rows = Object.keys(ABILITY_NAMES).map(k => `<div class="lvl-ab"><span>${ABILITY_NAMES[k]}</span><b>${hero[k] ?? 10}${plus[k] ? ` → ${Math.min(20, (hero[k] ?? 10) + plus[k])}` : ''}</b>
        <button class="btn btn-ghost btn-sm" onclick="levelupAbility('${k}',-1)" aria-label="Less ${ABILITY_NAMES[k]}">−</button>
        <button class="btn btn-ghost btn-sm" onclick="levelupAbility('${k}',1)" aria-label="More ${ABILITY_NAMES[k]}" ${(hero[k] ?? 10) + (plus[k] || 0) >= 20 ? 'disabled' : ''}>+</button></div>`).join('');
      return `<div class="lvl-note">Spend two points: +2 to one ability or +1 to two (20 at most).</div><div class="lvl-abs">${rows}</div>`
        + (step.feats.length ? `<div class="forge-title" style="font-size:11px;margin:14px 0 6px">Or take a feat</div><div class="lvl-grid">${step.feats.map(f => card(f.id, f.name + (f.homebrew ? ' ✦' : ''), [f.prerequisite, f.desc].filter(Boolean).join(' — ').slice(0, 220), choice?.kind === 'feat' && choice.id === f.id, 'feat', false)).join('')}</div>` : '');
    }
    case 'spells': {
      const c = choice?.cantrips || [], s = choice?.spells || [];
      return (step.cantrips ? `<div class="lvl-note">Choose ${step.cantrips} cantrip${step.cantrips === 1 ? '' : 's'}.</div><div class="lvl-grid">${step.options.cantrips.map(o => card(o.id, o.name, 'Cantrip', c.includes(o.id), 'cantrip', true)).join('')}</div>` : '')
        + (step.spells ? `<div class="lvl-note">Choose ${step.spells} spell${step.spells === 1 ? '' : 's'} (up to level ${step.maxLevel}).</div><div class="lvl-grid">${step.options.spells.map(o => card(o.id, o.name, `Level ${o.level}`, s.includes(o.id), 'spell', true)).join('')}</div>` : '');
    }
    case 'features':
      return step.list.length ? `<ul class="lvl-features">${step.list.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '<div class="lvl-note">No new features at this level — your other choices are the reward.</div>';
    default: return '';
  }
}

export function footer(error, isLast) {
  return `<div class="lvl-foot"><div class="lvl-error" role="alert">${esc(error || '')}</div>
    <button class="btn btn-ghost" onclick="levelupBack()">Back</button>
    <button class="btn btn-gold" id="lvl-next" onclick="levelupNext()">${isLast ? 'Finish level' : 'Next'}</button></div>`;
}
