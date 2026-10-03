// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-sealed.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-sealed.js' directly would make the plugin unmirrorable.

// lk-sealed.js — what a LanternKeep sidebar shows while it has nothing to offer yet: a closed, sealed tome.
//
// ⚠️ SOURCE; vendored into dnd-master and dnd-player (scripts/vendor-shared.mjs).
//
// Owner, 2026-10-03: the player and DM panels should not be usable before there is a hero, or before the DM has
// opened a campaign. They used to show the last campaign's sheet (a player making a new hero saw an old one) or
// the DM tools of a campaign nobody had opened. Sealed = nothing to click but what opens it.

const STYLE_ID = 'lk-sealed-style';
const CSS = `
.lk-sealed{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:100%;padding:28px 18px;text-align:center;color:var(--lk-text,#e8dcc0)}
.lk-sealed svg{width:132px;height:auto;overflow:visible}
.lk-sealed .glow{animation:lk-sealed-breathe 4.5s ease-in-out infinite;transform-origin:66px 72px}
.lk-sealed h2{font-family:var(--lk-title,serif);font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--lk-gold,#e0b552);margin:0;font-weight:600}
.lk-sealed p{font-size:12.5px;line-height:1.6;color:var(--lk-muted,#a8977a);margin:0;max-width:30ch}
.lk-sealed .btn{margin-top:4px}
@keyframes lk-sealed-breathe{0%,100%{opacity:.35;transform:scale(.96)}50%{opacity:.8;transform:scale(1.04)}}
@media (prefers-reduced-motion: reduce){.lk-sealed .glow{animation:none;opacity:.55}}`;

// A closed book, gold corners and clasp, a red wax seal with a lantern pressed in it.
const TOME = `<svg viewBox="0 0 132 150" aria-hidden="true">
  <defs>
    <radialGradient id="lks-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f3c96b" stop-opacity=".55"/><stop offset="1" stop-color="#f3c96b" stop-opacity="0"/></radialGradient>
    <linearGradient id="lks-cover" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2516"/><stop offset="1" stop-color="#1c120a"/></linearGradient>
    <radialGradient id="lks-wax" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#b2342a"/><stop offset="1" stop-color="#5c1611"/></radialGradient>
  </defs>
  <ellipse class="glow" cx="66" cy="72" rx="64" ry="64" fill="url(#lks-glow)"/>
  <rect x="22" y="14" width="88" height="118" rx="5" fill="#120b06"/>
  <rect x="18" y="10" width="88" height="118" rx="5" fill="url(#lks-cover)" stroke="#8a6a32" stroke-width="1.2"/>
  <rect x="26" y="18" width="72" height="102" rx="3" fill="none" stroke="#c9a14e" stroke-opacity=".55" stroke-width="1"/>
  <path d="M18 22 L30 10 M106 22 L94 10 M18 116 L30 128 M106 116 L94 128" stroke="#e0b552" stroke-width="3" stroke-linecap="round"/>
  <path d="M106 58 h14 a4 4 0 0 1 4 4 v16 a4 4 0 0 1 -4 4 h-14" fill="#2a1c10" stroke="#c9a14e" stroke-width="1.4"/>
  <circle cx="62" cy="69" r="19" fill="url(#lks-wax)"/>
  <path d="M43 69 q-3 6 2 9 M81 69 q3 6 -2 9 M55 51 q7 -4 14 0" fill="none" stroke="#7a1d16" stroke-width="2.4" stroke-linecap="round"/>
  <g fill="none" stroke="#2c0806" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".85">
    <path d="M57 60 h10 M62 57 v3"/><path d="M56 63 h12 l-1.5 13 h-9 z"/><path d="M60 67 q2 -3 4 0 q-1 3 -2 4 q-1 -1 -2 -4"/><path d="M55 76 h14"/>
  </g>
</svg>`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID; st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The sealed panel's markup. `action` (optional): { label, onclick } for the one thing that opens it. */
export function sealedHtml({ title, text, action } = {}) {
  ensureStyle();
  return `<div class="lk-sealed" role="status">${TOME}<h2>${esc(title)}</h2><p>${esc(text)}</p>`
    + (action ? `<button class="btn btn-ghost btn-sm" onclick="${esc(action.onclick)}">${esc(action.label)}</button>` : '')
    + '</div>';
}
