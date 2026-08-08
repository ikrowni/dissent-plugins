// core/config.js — tunable constants.
//
// Deliberately tiny. nfl-hub's config.js also carries 32 teams, their colours and their
// abbreviation aliases; none of that has a UFC analogue, so only the three timing
// constants that motion.js and scheduler.js import are carried over.

/** During a live card the tracking timeline is the product, so poll hard. */
export const POLL_LIVE_MS = 20_000;

/** Nothing is happening; a card is announced weeks out. */
export const POLL_IDLE_MS = 300_000;

/**
 * The animation frame cap.
 *
 * 30, not 60: an uncapped requestAnimationFrame in ChatBackground was this project's
 * measured idle-GPU hog, and a 15px animated dot in VoiceDock was ~68% of desktop idle
 * GPU on its own. core/motion.js enforces this — see its header.
 */
export const TARGET_FPS = 30;
