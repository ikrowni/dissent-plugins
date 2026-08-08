// core/motion.js — the motion budget, enforced rather than documented.
//
// The hub ships a deliberately cinematic look. Three incidents in this codebase show
// how that goes wrong: a 15px pulsing dot in VoiceDock measured ~68% of idle GPU,
// ChatBackground's uncapped rAF was the idle GPU hog, and animated avatars were 44% of
// idle GPU. Every one was continuous work while nobody was looking.
//
// So views cannot open their own rAF loop. They call motion.loop(), which is capped at
// TARGET_FPS, stops dead while the frame is hidden, and never starts at all when the
// user or their OS has asked for reduced motion.
import { TARGET_FPS } from './config.js';

export function createMotion({
  doc = globalThis.document,
  win = globalThis,
  fps = TARGET_FPS,
  reduceOverride = null,
} = {}) {
  const osReduce = () => {
    try {
      return win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
      return false;
    }
  };

  let override = reduceOverride; // null = defer to the OS
  const reduced = () => (override === null ? osReduce() : override === true);
  const hidden = () => doc?.visibilityState === 'hidden';

  const loops = new Set();

  function onVisibility() {
    for (const l of loops) (hidden() ? l.pause() : l.resume());
  }
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return {
    get enabled() { return !reduced(); },
    get bodyClass() { return reduced() ? 'reduce-motion' : ''; },

    /** Persisted by the caller into storage:user. null defers to the OS. */
    setReduceMotion(v) { override = v; },

    /**
     * Run cb(dtMs) at no more than `fps`, only while visible, only when motion is
     * enabled. Returns a stop function. This is the ONLY sanctioned animation loop.
     */
    loop(cb) {
      if (reduced()) return () => {};

      const minGap = 1000 / fps;
      let running = true;
      let paused = hidden();
      let raf = null;
      let last = 0;

      const frame = (now) => {
        if (!running) return;
        if (paused) { raf = null; return; }
        if (now - last >= minGap) {
          const dt = last ? now - last : minGap;
          last = now;
          try {
            cb(dt);
          } catch {
            // A throwing view must not kill the loop.
          }
        }
        raf = win.requestAnimationFrame(frame);
      };

      const handle = {
        pause() { paused = true; },
        resume() {
          if (!running || !paused) return;
          paused = false;
          last = 0;
          if (raf === null) raf = win.requestAnimationFrame(frame);
        },
      };
      loops.add(handle);

      if (!paused) raf = win.requestAnimationFrame(frame);

      return () => {
        running = false;
        loops.delete(handle);
        if (raf !== null) { win.cancelAnimationFrame?.(raf); raf = null; }
      };
    },

    destroy() {
      loops.clear();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}

export const motion = createMotion();
