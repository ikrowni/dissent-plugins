// core/scheduler.js — the plugin's ONE polling loop.
//
// No component owns a timer. Everything that needs periodic refresh registers here,
// and the whole loop stops when the frame is hidden. Three separate incidents in this
// codebase (VoiceDock's pulsing dot, ChatBackground's uncapped rAF, animated avatars)
// were all continuous work happening while nobody was looking.
import { POLL_LIVE_MS, POLL_IDLE_MS } from './config.js';

export function createScheduler({ doc = globalThis.document, intervalMs = POLL_IDLE_MS } = {}) {
  const tasks = new Set();
  let timer = null;
  let interval = intervalMs;
  let started = false;

  const hidden = () => doc?.visibilityState === 'hidden';

  function tick() {
    for (const task of tasks) {
      try {
        task();
      } catch {
        // One bad task must never stop the loop or its siblings.
      }
    }
  }

  function disarm() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function arm() {
    disarm();
    if (!started || hidden()) return;
    timer = setInterval(tick, interval);
  }

  function onVisibility() {
    if (!started) return;
    if (hidden()) {
      disarm();
    } else {
      tick(); // refresh immediately so returning never shows stale data
      arm();
    }
  }

  doc?.addEventListener?.('visibilitychange', onVisibility);

  return {
    add(task) {
      tasks.add(task);
      return () => tasks.delete(task);
    },
    remove(task) { tasks.delete(task); },

    start() {
      if (started) return;
      started = true;
      if (!hidden()) { tick(); arm(); }
    },

    stop() {
      started = false;
      disarm();
    },

    /** Swap cadence — callers use POLL_LIVE_MS while any game is live. */
    setInterval(ms) {
      interval = ms;
      if (started && !hidden()) arm();
    },

    destroy() {
      this.stop();
      tasks.clear();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },

    get isRunning() { return timer !== null; },
    get taskCount() { return tasks.size; },
  };
}

export { POLL_LIVE_MS, POLL_IDLE_MS };
