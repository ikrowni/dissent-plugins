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

  /**
   * ⚠️ THE HOLE visibilitychange DOES NOT COVER.
   *
   * `visibilitychange` fires when a tab is hidden or a window is MINIMISED. A window
   * merely sitting behind another application still reports `visibilityState:
   * 'visible'`, so a loop kept running at full rate with nobody looking. That is the
   * exact shape of all three GPU incidents in this project: a 15px pulsing dot at
   * ~68% of desktop idle GPU, an uncapped rAF as the idle hog, and animated avatars
   * at 44%. Every one was continuous work behind another window.
   *
   * `hasFocus()` is optional on the host; absent, assume focused rather than
   * refusing to animate at all.
   */
  let blurred = doc?.hasFocus?.() === false;
  const idle = () => hidden() || blurred;

  const loops = new Set();

  /**
   * ⚠️ THE CLASS DOES THE REAL WORK HERE.
   *
   * `motion.loop()` is the sanctioned rAF, but every ambient effect this hub ships
   * today is a CSS `animation: … infinite` — the hero sweep, the on-the-clock pulse,
   * the live dot, the skeleton shimmer, the spinner. None of them go through this
   * module, so gating only the loop would gate nothing. `body.motion-idle` in
   * motion.css pauses all of them.
   *
   * `animation-play-state: paused`, not `none`: an alt-tabbed window resumes mid-
   * animation rather than snapping to frame zero when it comes back.
   */
  function applyIdleClass() {
    doc?.body?.classList?.toggle?.('motion-idle', idle());
  }

  function sync() {
    for (const l of loops) (idle() ? l.pause() : l.resume());
    applyIdleClass();
  }

  const onVisibility = sync;
  const onBlur = () => { blurred = true; sync(); };
  const onFocus = () => { blurred = false; sync(); };

  doc?.addEventListener?.('visibilitychange', onVisibility);
  win?.addEventListener?.('blur', onBlur);
  win?.addEventListener?.('focus', onFocus);
  applyIdleClass();

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
      let paused = idle();
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
      win?.removeEventListener?.('blur', onBlur);
      win?.removeEventListener?.('focus', onFocus);
    },
  };
}

export const motion = createMotion();
