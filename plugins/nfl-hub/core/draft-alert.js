// core/draft-alert.js — the "you are on the clock" chime.
//
// Synthesised, not an asset: two short notes from an OscillatorNode cost no
// bytes, need no CSP allowance and cannot 404. Plugins run in a sandboxed frame
// with Web Audio available (dnd-master already ships sound).
//
// ⚠️ FIRES ON THE TRANSITION, never on state. The board polls every 3 s, so
// anything keyed on "it is my turn" rather than "it just became my turn" would
// chime for the entire pick.
const KEY = 'nfl:draft:alert';

export function alertEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setAlertEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

/**
 * Two rising notes, ~500 ms. Deliberately short and quiet: this competes with
 * whatever the manager is actually doing, and a long alert in a twelve-round
 * draft becomes something people mute permanently.
 */
export function playTurnAlert({ AudioCtx, enabled = alertEnabled } = {}) {
  if (!enabled()) return false;
  const Ctx = AudioCtx ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return false;
  try {
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [[880, 0], [1174.66, 0.16]].forEach(([hz, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      // Ramped, never a hard stop — an abrupt gate on a sine is an audible click.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    });
    return true;
  } catch {
    // Autoplay policy, no output device, a closed context — never break the board.
    return false;
  }
}

/** Did the clock just BECOME mine? Fold this over successive polls. */
export function becameMyTurn(wasMine, isMine) { return !wasMine && isMine; }
