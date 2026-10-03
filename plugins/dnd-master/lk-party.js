// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-party.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-party.js' directly would make the plugin unmirrorable.

// lk-party.js — Party at a glance: hero summaries → the DM's rows (everything) and the players' strip (no numbers).
//
// ⚠️ SOURCE; vendored into dnd-master and dnd-player (scripts/vendor-shared.mjs).
// Spec: docs/superpowers/specs/2026-10-03-lanternkeep-flow-design.md §5 (projects repo).
//
// 🔴 playerStrip() is a WHITELIST: a player must never learn a companion's HP, AC or passive Perception. Add a field
// to it only if a player may see it; the test checks the rendered HTML too.

const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const initialOf = name => (String(name || '?').trim()[0] || '?').toUpperCase();

export const BAND_WIDTH = { healthy: 100, hurt: 70, bloodied: 45, critical: 20, down: 0 };
const BAND_COLOR = { healthy: '#22c55e', hurt: '#84cc16', bloodied: '#f59e0b', critical: '#ef4444', down: '#6b7280' };

/** 'dead' | 'stable' | 'dying' | null. */
export function heroStatus(s) {
  if (s?.dead) return 'dead';
  if (s?.stable) return 'stable';
  return (s?.hp ?? 0) <= 0 ? 'dying' : null;
}

/** How hurt, in words: healthy (> 75 %), hurt (> 50 %), bloodied (> 25 %), critical, down (0 HP). */
export function hpBand(hp, hpMax) {
  if (hp <= 0) return 'down';
  const f = hpMax > 0 ? hp / hpMax : 1;
  return f > 0.75 ? 'healthy' : f > 0.5 ? 'hurt' : f > 0.25 ? 'bloodied' : 'critical';
}

const idsOf = (summaries, members) =>
  (members?.length ? members : Object.keys(summaries || {})).filter(id => summaries?.[id]);

/** The DM's view: one row per hero, every number. */
export function dmRows(summaries, members) {
  return idsOf(summaries, members).map(id => {
    const s = summaries[id];
    const status = heroStatus(s);
    const ds = s.deathSaves || { successes: 0, failures: 0 };
    return {
      userId: id, name: s.name || 'Hero', initial: initialOf(s.name), portraitUrl: s.portraitUrl || '',
      classLine: `${cap(s.class)} ${s.level || 1}`.trim(),
      hp: s.hp ?? 0, hpMax: s.hpMax ?? 0, hpTemp: s.hpTemp || 0, ac: s.ac ?? 10, passivePerception: s.passivePerception ?? 10,
      conditions: [...(s.conditions || [])], status,
      statusText: status === 'dead' ? 'Dead' : status === 'stable' ? 'Stable'
        : status === 'dying' ? `Dying ${ds.successes}✓ ${ds.failures}✗` : '',
      concentration: s.concentration || null,
    };
  });
}

/** A player's view of their companions: no HP, AC or passive Perception. */
export function playerStrip(summaries, selfId, members) {
  return idsOf(summaries, members).filter(id => id !== selfId).map(id => {
    const s = summaries[id];
    const down = !!s.dead || (s.hp ?? 0) <= 0;
    return {
      userId: id, name: s.name || 'Hero', initial: initialOf(s.name), portraitUrl: s.portraitUrl || '',
      band: down ? 'down' : hpBand(s.hp ?? 0, s.hpMax ?? 0), conditions: [...(s.conditions || [])], down,
    };
  });
}

const avatar = (e, px) => e.portraitUrl
  ? `<img src="${escHtml(e.portraitUrl)}" alt="" style="width:${px}px;height:${px}px;border-radius:50%;object-fit:cover;flex-shrink:0">`
  : `<div style="width:${px}px;height:${px}px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--surface);border:1px solid var(--gold);color:var(--gold);font-weight:700;font-size:${Math.round(px / 2.2)}px">${escHtml(e.initial)}</div>`;

const chips = conds => conds.map(c =>
  `<span title="${escHtml(c)}" style="font-size:8px;font-weight:700;padding:1px 3px;border-radius:3px;background:var(--surface);border:1px solid #f59e0b;color:#f59e0b">${escHtml(String(c).slice(0, 3).toUpperCase())}</span>`).join('');

/** The DM's panel. Each row opens the player editor (window.openPartyMember). */
export function dmPartyHtml(rows) {
  if (!rows.length) return '<div style="font-size:10px;color:var(--muted);padding:6px 2px">No heroes yet.</div>';
  return rows.map(r => {
    const pct = r.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((r.hp / r.hpMax) * 100))) : 0;
    const color = BAND_COLOR[hpBand(r.hp, r.hpMax)];
    return `<div class="party-row" data-uid="${escHtml(r.userId)}" onclick="openPartyMember('${escHtml(r.userId)}')" ` +
      'style="display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--border);cursor:pointer">' +
      avatar(r, 28) +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px">' +
          `<b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</b>` +
          `<span style="color:var(--muted);font-size:10px;white-space:nowrap">${escHtml(r.classLine)}</span></div>` +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:3px">' +
          `<div style="flex:1;height:5px;background:var(--border);border-radius:3px"><div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div></div>` +
          `<span style="font-size:10px;white-space:nowrap">${r.hp}/${r.hpMax}${r.hpTemp ? ` <span style="color:#60a5fa">+${r.hpTemp}</span>` : ''}</span></div>` +
        '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:3px;font-size:9px;color:var(--muted)">' +
          `<span>AC ${r.ac}</span><span>PP ${r.passivePerception}</span>${chips(r.conditions)}` +
          (r.statusText ? `<span style="color:${r.status === 'stable' ? '#22c55e' : '#ef4444'};font-weight:700">${escHtml(r.statusText)}</span>` : '') +
          (r.concentration ? `<span style="color:var(--gold,#d4af37)">Concentrating: ${escHtml(r.concentration)}</span>` : '') +
        '</div>' +
      '</div></div>';
  }).join('');
}

/** A player's strip of companions. */
export function playerStripHtml(entries) {
  if (!entries.length) return '';
  return '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' + entries.map(e =>
    `<div class="party-mate" data-uid="${escHtml(e.userId)}" data-band="${e.band}" style="display:flex;gap:5px;align-items:center;min-width:0;flex:0 1 auto">` +
      avatar(e, 22) +
      '<div style="min-width:44px;max-width:90px">' +
        `<div style="font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.name)}</div>` +
        `<div style="height:4px;background:var(--border);border-radius:2px;margin-top:2px"><div style="height:100%;width:${BAND_WIDTH[e.band]}%;background:${BAND_COLOR[e.band]};border-radius:2px"></div></div>` +
        `<div style="display:flex;gap:2px;margin-top:2px">${e.down ? '<span style="font-size:8px;font-weight:700;color:#ef4444">Down</span>' : ''}${chips(e.conditions)}</div>` +
      '</div></div>').join('') + '</div>';
}
