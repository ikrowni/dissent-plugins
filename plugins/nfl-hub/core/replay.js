// core/replay.js — replays a recorded game through the real parsers.
//
// Why this exists: the hub was built in preseason, when drive charts, play-by-play and
// win probability had no live game to develop against. Rather than ship those blind and
// find out in September, a recorded game (tests/fixtures/) plays back through the same
// parse → render path at accelerated speed. It also gives the live-game views
// deterministic unit tests.
//
// Enable with ?replay=<name> on the plugin url.
import { parsePlays, parseDrives, parseProbabilities } from './espn-game.js';

export function isReplayRequested(search = globalThis.location?.search ?? '') {
  return replayFixtureName(search) !== null;
}

export function replayFixtureName(search = globalThis.location?.search ?? '') {
  const v = new URLSearchParams(search).get('replay');
  return v || null;
}

export function createReplay({ plays, drives, probabilities, stepMs = 1000 }) {
  // Parsers hand back plays newest-first and probabilities oldest-first. Replay walks
  // the game forwards, so keep a chronological copy of the plays to advance through.
  const allPlays = parsePlays(plays);
  const chronological = [...allPlays].sort((a, b) => a.seq - b.seq);
  const allDrives = parseDrives(drives);
  const allProb = parseProbabilities(probabilities);

  let cursor = 0; // number of plays revealed
  let timer = null;
  const subscribers = new Set();

  const notify = () => {
    for (const fn of subscribers) {
      try {
        fn();
      } catch {
        // A throwing subscriber must not break the step.
      }
    }
  };

  function stopTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function state() {
    const revealed = chronological.slice(0, cursor);
    const latest = revealed.at(-1) ?? null;

    // A drive is visible once the replay has passed its opening play. Drives carry no
    // sequence number, so gate on start period plus how far through the game we are —
    // monotonic in cursor, which is what the render needs.
    const maxPeriod = latest?.period ?? 0;
    const fraction = chronological.length ? cursor / chronological.length : 1;
    const visibleDrives = allDrives.filter((d, i) => {
      if (d.startPeriod === null) return false;
      if (d.startPeriod < maxPeriod) return true;
      if (d.startPeriod > maxPeriod) return false;
      return i / Math.max(allDrives.length, 1) <= fraction;
    });

    return {
      plays: revealed.slice().reverse(), // newest-first, matching parsePlays
      drives: visibleDrives,
      winProb: allProb.slice(0, cursor),
      homeScore: latest?.homeScore ?? 0,
      awayScore: latest?.awayScore ?? 0,
      period: latest?.period ?? 1,
      clock: latest?.clock ?? null,
      lastPlay: latest?.text ?? null,
      progress: chronological.length ? cursor / chronological.length : 1,
      done: cursor >= chronological.length,
      totalPlays: chronological.length,
    };
  }

  const api = {
    state,

    step() {
      if (cursor < chronological.length) cursor += 1;
      if (cursor >= chronological.length) stopTimer();
      notify();
    },

    seek(index) {
      cursor = Math.max(0, Math.min(Number(index) || 0, chronological.length));
      notify();
    },

    play() {
      if (timer !== null) return;
      timer = setInterval(() => api.step(), stepMs);
    },

    pause() { stopTimer(); },

    reset() { stopTimer(); cursor = 0; notify(); },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    get isPlaying() { return timer !== null; },
  };

  return api;
}

/** Load a named replay's fixtures from the plugin's own origin. */
export async function loadReplay(name, { stepMs = 1000 } = {}) {
  const base = 'tests/fixtures';
  const [plays, drives, probabilities] = await Promise.all([
    fetch(`${base}/plays-${name}.json`).then((r) => r.json()),
    fetch(`${base}/drives-${name}.json`).then((r) => r.json()),
    fetch(`${base}/probabilities-${name}.json`).then((r) => r.json()),
  ]);
  return createReplay({ plays, drives, probabilities, stepMs });
}
