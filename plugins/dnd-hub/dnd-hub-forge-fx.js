// dnd-hub-forge-fx.js — the Hero Forge's living background: embers rising, lantern flicker, a little parallax, tinted
// by the chosen race. Off under prefers-reduced-motion. Pauses while the page is hidden.
const MAX_EMBERS = 70;

export function createForgeFx(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let tint = '#e0b552', raf = 0, running = false, px = 0, py = 0;
  const embers = [];

  const size = () => {
    const r = canvas.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, r.width * d); canvas.height = Math.max(1, r.height * d);
  };
  const spawn = () => ({ x: Math.random() * canvas.width, y: canvas.height + Math.random() * 40, r: 0.6 + Math.random() * 1.8,
    vy: 0.3 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 0.3, life: 0, max: 300 + Math.random() * 400, z: Math.random() });
  const onMove = e => { const r = canvas.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; };

  const frame = t => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Lantern light: a soft pool low in the frame, breathing.
    const flicker = 0.85 + 0.15 * Math.sin(t / 310) * Math.sin(t / 97);
    const g = ctx.createRadialGradient(w * (0.5 + px * 0.05), h * 0.9, 0, w * 0.5, h * 0.9, h * 0.9);
    g.addColorStop(0, hexA(tint, 0.22 * flicker)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    while (embers.length < MAX_EMBERS) embers.push(spawn());
    for (const e of embers) {
      e.life++; e.y -= e.vy; e.x += e.vx + Math.sin((e.life + e.z * 100) / 40) * 0.2;
      const a = Math.min(1, e.life / 40) * Math.max(0, 1 - e.life / e.max);
      ctx.fillStyle = hexA(tint, a * 0.9);
      ctx.beginPath(); ctx.arc(e.x - px * 30 * e.z, e.y - py * 20 * e.z, e.r * (1 + e.z), 0, Math.PI * 2); ctx.fill();
      if (e.life > e.max || e.y < -10) Object.assign(e, spawn());
    }
  };

  return {
    get running() { return running; },
    start() {
      if (reduced || running) return;
      running = true; size();
      window.addEventListener('resize', size); window.addEventListener('pointermove', onMove);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener('resize', size); window.removeEventListener('pointermove', onMove);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    setTint(hex) { tint = hex || tint; },
  };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
}
