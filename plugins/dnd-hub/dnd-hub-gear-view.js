// dnd-hub-gear-view.js — the starting-gear screen both creators show: the class's "(a) or (b)" choices, what every
// member of the class gets, what's in each pack, the background's gear, and the shop for starting gold.
// Rules and data: dnd-hub-starting-gear.js. The creator that shows it calls setGearTarget with its draft and redraw.
import { esc } from '../plugin-sdk.js';
import { gearFor, partLabel, pickOptions, pickKey, PACK_CONTENTS, backgroundGear, applyGear, draftGear,
  costCp, fmtCp, spentCp, buyItem, shopItems, SHOP_CATEGORIES } from './dnd-hub-starting-gear.js';

let _t = null; // { draft: () => draft, srd, budgetGp: () => number, redraw }
export function setGearTarget(t) { _t = t; }

const nameOf = (id, eq) => eq.find(e => e.id === id)?.name || id;

function pickSelects(parts, c, o, gear, eq) {
  return parts.map((p, part) => {
    if (!p.pick) return '';
    const opts = pickOptions(p.pick, eq);
    return Array.from({ length: p.count }, (_, n) => {
      const key = pickKey(c, o, part) + (n ? '.' + n : '');
      const cur = opts.includes(gear.picks?.[key]) ? gear.picks[key] : opts[0];
      return `<label class="lk-gear-pick">${esc(partLabel({ ...p, count: 1 }, eq))}
        <select onchange="gearPick('${key}', this.value)">${opts.map(id =>
          `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(nameOf(id, eq))}</option>`).join('')}</select></label>`;
    }).join('');
  }).join('');
}

const packNote = parts => parts.filter(p => PACK_CONTENTS[p.id]).map(p => `Holds ${PACK_CONTENTS[p.id]}.`).join(' ');

/** The class's choices and fixed gear, and the background's, for `draft`. */
export function gearChooserHtml(draft, srd) {
  const eq = srd?.equipment || [];
  const g = gearFor(draft.class);
  if (!g) return '<div class="lvl-note">This class has no starting equipment list: take the gold and buy your own.</div>';
  const gear = draftGear(draft);
  const proficient = new Set(g.proficient || []);
  const choices = g.choices.map((options, c) => {
    const chosen = Math.min(Math.max(0, gear.opts[c] || 0), options.length - 1);
    return `<div class="lk-gear-choice"><div class="lk-gear-q">Choose one</div><div class="lvl-grid">${options.map((parts, o) => {
      const joined = parts.map(p => partLabel(p, eq)).join(' + ');
      const label = joined[0].toUpperCase() + joined.slice(1);
      const sub = [parts.some(p => proficient.has(p.id)) ? 'Only if your class lets you use it (ask your DM).' : '', packNote(parts)]
        .filter(Boolean).join(' ');
      return `<button class="lvl-card" aria-pressed="${o === chosen}" onclick="gearOpt(${c}, ${o})"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`;
    }).join('')}</div>${pickSelects(options[chosen], c, chosen, gear, eq)}</div>`;
  }).join('');
  const fixed = g.fixed.length ? `<div class="lk-gear-choice"><div class="lk-gear-q">Every ${esc(draft.class)} also gets</div>
    <div class="lk-gear-list">${esc(g.fixed.map(p => partLabel(p, eq)).join(', '))}</div>
    ${packNote(g.fixed) ? `<div class="lk-gear-sub">${esc(packNote(g.fixed))}</div>` : ''}${pickSelects(g.fixed, 'f', 0, gear, eq)}</div>` : '';
  const bgRec = (srd?.backgrounds || []).find(b => b.id === draft.background);
  const bg = backgroundGear(bgRec, eq);
  const bgNames = [...bg.items.map(x => nameOf(x.id, eq)), ...bg.named];
  const bgHtml = bgNames.length ? `<div class="lk-gear-choice"><div class="lk-gear-q">From your background (${esc(bgRec.name)})</div>
    <div class="lk-gear-list">${esc(bgNames.join(', '))}</div></div>` : '';
  return choices + fixed + bgHtml;
}

let _shopTab = SHOP_CATEGORIES[0];

/** Starting gold: a shop by category, what is bought, and what is left. */
export function gearShopHtml(draft, srd, budgetGp) {
  const eq = srd?.equipment || [];
  const budget = budgetGp * 100, spent = spentCp(draft.buy, eq), left = budget - spent;
  const bought = Object.entries(draft.buy || {}).filter(([, n]) => n > 0);
  return `<div class="lk-gear-purse"><b>${fmtCp(left)}</b> left of ${budgetGp} gp</div>
    ${bought.length ? `<div class="lk-gear-list" style="margin-bottom:8px">${bought.map(([id, n]) =>
      `<span class="lk-gear-chip">${n > 1 ? n + ' × ' : ''}${esc(nameOf(id, eq))}<button onclick="gearBuy('${esc(id)}', -1)" aria-label="Remove one">×</button></span>`).join('')}</div>`
      : '<div class="lk-gear-sub" style="margin-bottom:8px">Nothing bought yet. What you do not spend you keep.</div>'}
    <div class="lk-gear-tabs">${SHOP_CATEGORIES.map(c => `<button class="${c === _shopTab ? 'on' : ''}" onclick="gearShopTab('${c}')">${esc(c === 'Adventuring Gear' ? 'Gear' : c)}</button>`).join('')}</div>
    <div class="lk-gear-shop">${shopItems(eq, _shopTab).map(e => {
      const cp = costCp(e.cost), n = draft.buy?.[e.id] || 0;
      return `<div class="lk-gear-row"><span>${esc(e.name)}${PACK_CONTENTS[e.id] ? `<small>Holds ${esc(PACK_CONTENTS[e.id])}.</small>` : ''}</span>
        <small>${fmtCp(cp)}</small>${n ? `<b>${n}</b>` : ''}
        <button class="btn btn-ghost btn-sm" ${cp > left ? 'disabled' : ''} onclick="gearBuy('${esc(e.id)}', 1)">Buy</button></div>`;
    }).join('')}</div>`;
}

/** Gold left after shopping, for the saved hero. */
export const goldLeft = (draft, srd, budgetGp) => Math.max(0, Math.floor((budgetGp * 100 - spentCp(draft.buy, srd?.equipment || [])) / 100));

// ── Handlers (window.*) ────────────────────────────────────────────────────────────────────────────────────────
// A redraw keeps the shop's scroll place: buying the tenth item on the list must not jump back to the first.
function redraw() {
  const top = document.querySelector('.lk-gear-shop')?.scrollTop || 0;
  _t?.redraw();
  const shop = document.querySelector('.lk-gear-shop');
  if (shop) shop.scrollTop = top;
}
function changed() { const d = _t?.draft(); if (d) applyGear(d, _t.srd); redraw(); }
export function gearOpt(c, o) { const d = _t?.draft(); if (!d) return; draftGear(d).opts[c] = o; changed(); }
export function gearPick(key, id) { const d = _t?.draft(); if (!d) return; (draftGear(d).picks ||= {})[key] = id; changed(); }
/** Kit or gold: `mode` 'kit' | 'gold'. */
export function gearMode(mode) { const d = _t?.draft(); if (!d) return; d.useStartingGold = mode === 'gold'; changed(); }
export function gearBuy(id, delta) {
  const d = _t?.draft(); if (!d) return;
  if (buyItem(d, id, delta, _t.budgetGp() * 100, _t.srd?.equipment || [])) changed();
}
export function gearShopTab(cat) { if (SHOP_CATEGORIES.includes(cat)) { _shopTab = cat; _t?.redraw(); } }

/** The kit-or-gold switch and the screen under it, for the full creator. */
export function gearStepHtml(draft, srd, budgetGp) {
  if (!draft.useStartingGold) applyGear(draft, srd);
  return `<div class="lvl-grid" style="margin-bottom:14px">
      <button class="lvl-card" aria-pressed="${!draft.useStartingGold}" onclick="gearMode('kit')"><b>Starting equipment</b><span>Your class's gear, with a choice at each step.</span></button>
      <button class="lvl-card" aria-pressed="${!!draft.useStartingGold}" onclick="gearMode('gold')"><b>${budgetGp} gold instead</b><span>Buy your own now; what you do not spend you keep.</span></button></div>`
    + (draft.useStartingGold ? gearShopHtml(draft, srd, budgetGp) : gearChooserHtml(draft, srd));
}
