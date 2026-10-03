import { describe, it, expect } from 'vitest';
import { defaultSceneId, defaultMusic, sessionMusic, recapTitle, newSession, currentSession, draftRecap } from './dnd-master-session-rules.js';

const scenes = { s1: { id: 's1', name: 'Cove', mapId: 'm1', soundtrackFileId: 'f1', ambientVolume: 0.4 }, s2: { id: 's2', name: 'Lamp Room', mapId: 'm2' } };

describe('defaultSceneId', () => {
  it('the last scene loaded, else the scene on the active map, else none', () => {
    expect(defaultSceneId({ scenes, lastSceneId: 's2', activeMapId: 'm1' })).toBe('s2');
    expect(defaultSceneId({ scenes, lastSceneId: 'gone', activeMapId: 'm1' })).toBe('s1');
    expect(defaultSceneId({ scenes, activeMapId: 'm9' })).toBe('');
    expect(defaultSceneId({})).toBe('');
  });
});

describe('music', () => {
  it('a scene with a soundtrack defaults to it; otherwise the ambience', () => {
    expect(defaultMusic(scenes.s1)).toBe('scene');
    expect(defaultMusic(scenes.s2)).toBe('ambience');
    expect(defaultMusic(null)).toBe('ambience');
  });
  it('what Start sends', () => {
    expect(sessionMusic(scenes.s1, 'scene')).toEqual({ mode: 'scene', soundtrackFileId: 'f1', volume: 0.4 });
    expect(sessionMusic(scenes.s2, 'scene')).toEqual({ mode: 'ambience', soundtrackFileId: null, volume: 0.35 });
    expect(sessionMusic(null, 'off')).toEqual({ mode: 'off', soundtrackFileId: null, volume: 0.35 });
  });
});

describe('records', () => {
  it('recap title', () => {
    expect(recapTitle(new Date('2026-10-03T19:00:00Z'))).toBe('Last time — 3 Oct 2026');
  });
  it('a new session remembers every hero\'s level', () => {
    const c = { characterSummaries: { u1: { level: 1 }, u2: { level: 2 } } };
    expect(newSession(c, { id: 'x', sceneId: 's1', journalId: 'j', now: new Date('2026-10-03T19:00:00Z') }))
      .toEqual({ id: 'x', startedAt: '2026-10-03T19:00:00.000Z', sceneId: 's1', journalId: 'j', startLevels: { u1: 1, u2: 2 } });
  });
  it('the current session is the last one not ended', () => {
    expect(currentSession({ sessions: [{ id: 'a', endedAt: 'x' }, { id: 'b' }] }).id).toBe('b');
    expect(currentSession({ sessions: [{ id: 'a', endedAt: 'x' }] })).toBe(null);
    expect(currentSession({})).toBe(null);
  });
});

describe('draftRecap', () => {
  const log = [
    { ts: '2026-10-03T18:00:00Z', type: 'combat-start', message: 'old fight' },
    { ts: '2026-10-03T19:10:00Z', type: 'combat-start', message: 'Encounter launched' },
    { ts: '2026-10-03T19:40:00Z', type: 'loot', message: 'Bree took Potion of Healing' },
    { ts: '2026-10-03T20:05:00Z', type: 'combat-start', message: 'Encounter launched' },
  ];
  it('the scene, fights, loot and level-ups since the session began', () => {
    const text = draftRecap({ log, since: '2026-10-03T19:00:00.000Z', sceneName: 'Lamp Room',
      startLevels: { u1: 1, u2: 1 }, summaries: { u1: { name: 'Bree', level: 2 }, u2: { name: 'Ael', level: 1 } } });
    expect(text).toBe('Last time, the party was at Lamp Room.\nThey fought 2 battles.\nBree took Potion of Healing.\nBree reached level 2.');
  });
  it('one battle, no scene, nothing else', () => {
    expect(draftRecap({ log: [log[1]], since: '2026-10-03T19:00:00.000Z' })).toBe('They fought 1 battle.');
  });
  it('a quiet evening drafts nothing', () => {
    expect(draftRecap({ log: [], since: '2026-10-03T19:00:00.000Z' })).toBe('');
  });
});
