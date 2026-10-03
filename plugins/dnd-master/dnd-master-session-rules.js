// dnd-master-session-rules.js — Start session / End session decisions (spec 2026-10-03 §6). Pure.

export const AMBIENCE_VOLUME = 0.35;

/** The scene Start offers: the last one loaded, else the one on the active map, else none (''). */
export function defaultSceneId(c) {
  const scenes = c?.scenes || {};
  if (c?.lastSceneId && scenes[c.lastSceneId]) return c.lastSceneId;
  return Object.values(scenes).find(s => s.mapId && s.mapId === c?.activeMapId)?.id || '';
}

/** 'scene' when the scene has a soundtrack, else 'ambience'. */
export const defaultMusic = scene => (scene?.soundtrackFileId ? 'scene' : 'ambience');

/** What Start sends. A 'scene' choice without a soundtrack falls back to the ambience. */
export function sessionMusic(scene, mode) {
  const m = mode === 'scene' && !scene?.soundtrackFileId ? 'ambience' : mode;
  return {
    mode: m,
    soundtrackFileId: m === 'scene' ? scene.soundtrackFileId : null,
    volume: m === 'scene' ? (scene.ambientVolume ?? 0.5) : AMBIENCE_VOLUME,
  };
}

export const recapTitle = date =>
  `Last time — ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;

/** The record Start adds to campaign.sessions. Hero levels are kept so End can tell who levelled up. */
export function newSession(c, { id, sceneId, journalId, now }) {
  const startLevels = Object.fromEntries(Object.entries(c?.characterSummaries || {}).map(([uid, s]) => [uid, s.level || 1]));
  return { id, startedAt: now.toISOString(), sceneId: sceneId || '', journalId: journalId || null, startLevels };
}

/** The last session that has not ended, or null. */
export function currentSession(c) {
  const last = (c?.sessions || []).at(-1);
  return last && !last.endedAt ? last : null;
}

/** End session's draft of the next "Last time…": the scene, fights, loot and level-ups since `since`. */
export function draftRecap({ log = [], since, startLevels = {}, summaries = {}, sceneName = '' }) {
  const recent = log.filter(e => !since || String(e.ts) >= since);
  const lines = [];
  if (sceneName) lines.push(`Last time, the party was at ${sceneName}.`);
  const fights = recent.filter(e => e.type === 'combat-start').length;
  if (fights) lines.push(`They fought ${fights} battle${fights === 1 ? '' : 's'}.`);
  for (const e of recent.filter(e => e.type === 'loot')) lines.push(`${e.message}.`);
  for (const [uid, s] of Object.entries(summaries)) {
    if (startLevels[uid] != null && (s.level || 1) > startLevels[uid]) lines.push(`${s.name || 'A hero'} reached level ${s.level}.`);
  }
  return lines.join('\n');
}
