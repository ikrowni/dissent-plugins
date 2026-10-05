// dnd-hub-condition-fx.js — a short effect on a player's own screen when their hero gains a condition (owner,
// 2026-10-05). Each one looks like what it is: poison bubbles up green, fear shakes the screen red, a charm floats
// hearts. CSS only, about two seconds, never in the way of a click; reduced motion gets a plain caption.

const FX = {
  blinded:       { text: 'Blinded', sub: 'You cannot see', cls: 'blind' },
  charmed:       { text: 'Charmed', sub: 'Someone has caught your heart', cls: 'charm', bits: '♥', n: 14 },
  deafened:      { text: 'Deafened', sub: 'The world goes quiet', cls: 'deaf', rings: 4 },
  frightened:    { text: 'Frightened', sub: 'Fear grips you', cls: 'fear' },
  grappled:      { text: 'Grappled', sub: 'You are held fast', cls: 'grab' },
  incapacitated: { text: 'Incapacitated', sub: 'You can take no actions', cls: 'grey' },
  invisible:     { text: 'Invisible', sub: 'You fade from sight', cls: 'invis' },
  paralyzed:     { text: 'Paralyzed', sub: 'You cannot move', cls: 'frost' },
  petrified:     { text: 'Petrified', sub: 'You are turning to stone', cls: 'stone' },
  poisoned:      { text: 'Poisoned', sub: 'Your stomach turns', cls: 'poison', bits: '●', n: 18 },
  prone:         { text: 'Prone', sub: 'You are knocked down', cls: 'prone' },
  restrained:    { text: 'Restrained', sub: 'You are bound', cls: 'bind' },
  stunned:       { text: 'Stunned', sub: 'Your head is ringing', cls: 'stun', bits: '✦', n: 7 },
  unconscious:   { text: 'Unconscious', sub: 'Everything goes dark', cls: 'out' },
  exhaustion:    { text: 'Exhausted', sub: 'Your limbs are heavy', cls: 'tired' },
};

let _styled = false;
function style() {
  if (_styled) return;
  _styled = true;
  const s = document.createElement('style');
  s.textContent = `
.lkfx{position:absolute;inset:0;z-index:70;pointer-events:none;overflow:hidden;animation:lkfx-out 2.6s ease forwards}
.lkfx-cap{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);text-align:center;font-family:var(--lk-title,Georgia,serif);
  color:#fff;text-shadow:0 2px 10px #000,0 0 24px rgba(0,0,0,.8);animation:lkfx-cap 2.4s ease forwards}
.lkfx-cap b{display:block;font-size:34px;letter-spacing:.08em}.lkfx-cap span{font-size:14px;opacity:.85}
.lkfx-bit{position:absolute;bottom:-20px;font-size:22px;animation:lkfx-rise 2.2s ease-in forwards}
.lkfx.blind{background:radial-gradient(circle,transparent 0,transparent 10%,#000 60%);animation:lkfx-blind 2.6s ease forwards}
.lkfx.charm{background:radial-gradient(circle,transparent 40%,rgba(236,72,153,.35))}.lkfx.charm .lkfx-bit{color:#f472b6}
.lkfx.deaf .lkfx-ring{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px;border:2px solid rgba(200,200,220,.7);border-radius:50%;animation:lkfx-ring 2s ease-out forwards}
.lkfx.fear{background:radial-gradient(circle,transparent 35%,rgba(150,0,0,.55));animation:lkfx-out 2.6s ease forwards,lkfx-shake .5s linear 3}
.lkfx.grab::before,.lkfx.grab::after{content:'';position:absolute;top:0;bottom:0;width:22%;background:rgba(20,12,6,.85);animation:lkfx-grab 2.4s ease forwards}
.lkfx.grab::before{left:0;transform:translateX(-100%)}.lkfx.grab::after{right:0;transform:translateX(100%)}
.lkfx.grey{backdrop-filter:grayscale(1);background:rgba(60,60,60,.25)}
.lkfx.invis{background:repeating-linear-gradient(0deg,rgba(255,255,255,.08) 0 2px,transparent 2px 6px);animation:lkfx-out 2.6s ease forwards,lkfx-shimmer .3s steps(2) 6}
.lkfx.frost{box-shadow:inset 0 0 120px 40px rgba(170,215,255,.75);background:rgba(170,215,255,.12)}
.lkfx.stone{background:linear-gradient(to top,rgba(110,105,100,.85),transparent);animation:lkfx-out 2.6s ease forwards,lkfx-climb 2.2s ease forwards;transform-origin:bottom}
.lkfx.poison{background:radial-gradient(circle,transparent 40%,rgba(34,139,34,.45))}.lkfx.poison .lkfx-bit{color:#4ade80;font-size:16px}
.lkfx.prone{animation:lkfx-out 2.6s ease forwards}
.lkfx.bind{background:repeating-linear-gradient(45deg,rgba(120,80,40,.55) 0 6px,transparent 6px 40px),repeating-linear-gradient(-45deg,rgba(120,80,40,.55) 0 6px,transparent 6px 40px);animation:lkfx-out 2.6s ease forwards,lkfx-squeeze 2.2s ease forwards}
.lkfx.stun .lkfx-bit{color:#fde047;bottom:auto;top:30%;left:50%;animation:lkfx-orbit 1.4s linear infinite}
.lkfx.out{background:#000;animation:lkfx-faint 3s ease forwards}
.lkfx.tired{backdrop-filter:blur(2px) brightness(.7)}
@keyframes lkfx-out{0%{opacity:0}12%{opacity:1}75%{opacity:1}100%{opacity:0}}
@keyframes lkfx-cap{0%{opacity:0;transform:translate(-50%,-40%) scale(.9)}15%{opacity:1;transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0}}
@keyframes lkfx-rise{to{transform:translateY(-110vh) rotate(25deg);opacity:0}}
@keyframes lkfx-blind{0%{opacity:0}25%{opacity:1}70%{opacity:1}100%{opacity:0}}
@keyframes lkfx-ring{to{width:520px;height:520px;margin:-260px;opacity:0}}
@keyframes lkfx-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-6px,3px)}50%{transform:translate(5px,-4px)}75%{transform:translate(-3px,-2px)}}
@keyframes lkfx-grab{30%,70%{transform:translateX(0)}100%{opacity:0}}
@keyframes lkfx-shimmer{50%{opacity:.4}}
@keyframes lkfx-climb{0%{transform:scaleY(0)}60%{transform:scaleY(1)}}
@keyframes lkfx-squeeze{0%{transform:scale(1.4)}50%{transform:scale(1)}}
@keyframes lkfx-orbit{from{transform:rotate(0) translateX(70px) rotate(0)}to{transform:rotate(360deg) translateX(70px) rotate(-360deg)}}
@keyframes lkfx-faint{0%{opacity:0}40%{opacity:.92}80%{opacity:.92}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.lkfx,.lkfx *{animation-duration:.01ms!important;animation-iteration-count:1!important}.lkfx{animation:lkfx-out 2.6s linear forwards!important}}
`;
  document.head.appendChild(s);
}

/** Play `condition`'s effect over the map (`root`: the map area). Unknown conditions get a plain caption. */
export function playConditionFx(condition, root = document.getElementById('map-canvas-wrap')) {
  if (!root) return;
  style();
  const key = String(condition || '').toLowerCase();
  const fx = FX[key] || { text: condition, sub: '', cls: '' };
  const el = document.createElement('div');
  el.className = `lkfx ${fx.cls}`;
  for (let i = 0; i < (fx.n || 0); i++) {
    const b = document.createElement('div');
    b.className = 'lkfx-bit';
    b.textContent = fx.bits;
    b.style.left = `${(i * 37 + 11) % 100}%`;
    b.style.animationDelay = `${(i % 5) * 0.12}s`;
    if (key === 'stunned') b.style.animationDelay = `${-i * 0.2}s`;
    el.appendChild(b);
  }
  for (let i = 0; i < (fx.rings || 0); i++) {
    const r = document.createElement('div');
    r.className = 'lkfx-ring';
    r.style.animationDelay = `${i * 0.35}s`;
    el.appendChild(r);
  }
  const cap = document.createElement('div');
  cap.className = 'lkfx-cap';
  cap.innerHTML = '<b></b><span></span>';
  cap.querySelector('b').textContent = fx.text;
  cap.querySelector('span').textContent = fx.sub;
  el.appendChild(cap);
  root.appendChild(el);
  if (key === 'prone') root.animate?.([{ transform: 'none' }, { transform: 'rotate(-6deg) translateY(24px)' }, { transform: 'none' }], { duration: 900, easing: 'ease-out' });
  setTimeout(() => el.remove(), 3200);
}

const _seen = {}; // token id → the conditions it had last time we looked

/**
 * My hero's conditions as they stand now: play an effect for each one that is new. The first look only remembers
 * (a reload does not replay everything the hero already has).
 */
export function noticeMyConditions(token) {
  if (!token) return;
  const now = (token.conditions || []).map(c => String(c));
  const before = _seen[token.id];
  _seen[token.id] = now;
  if (!before) return;
  const fresh = now.filter(c => !before.includes(c));
  fresh.forEach((c, i) => setTimeout(() => playConditionFx(c), i * 2700));
}
