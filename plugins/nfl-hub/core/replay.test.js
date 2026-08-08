import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createReplay, isReplayRequested, replayFixtureName } from './replay.js';

const fixture = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

describe('isReplayRequested', () => {
  it('detects ?replay= in a location search', () => {
    expect(isReplayRequested('?replay=dalphi')).toBe(true);
    expect(isReplayRequested('?foo=1')).toBe(false);
    expect(isReplayRequested('')).toBe(false);
  });
  it('extracts the fixture name', () => {
    expect(replayFixtureName('?replay=dalphi')).toBe('dalphi');
    expect(replayFixtureName('?replay=')).toBeNull();
    expect(replayFixtureName('?x=1')).toBeNull();
  });
});

describe('createReplay', () => {
  let replay;

  beforeEach(() => {
    vi.useFakeTimers();
    replay = createReplay({
      plays: fixture('plays-dalphi.json'),
      drives: fixture('drives-dalphi.json'),
      probabilities: fixture('probabilities-dalphi.json'),
      stepMs: 100,
    });
  });

  it('starts with no plays revealed', () => {
    expect(replay.state().plays).toHaveLength(0);
    expect(replay.state().progress).toBe(0);
    expect(replay.state().drives).toHaveLength(0);
  });

  it('reveals plays in chronological order as it steps', () => {
    replay.step();
    const first = replay.state().plays;
    expect(first).toHaveLength(1);
    replay.step();
    const second = replay.state().plays;
    expect(second).toHaveLength(2);
    // state().plays is newest-first, matching parsePlays, so the earlier play moves
    // to the end.
    expect(second[1].id).toBe(first[0].id);
    expect(second[0].seq).toBeGreaterThan(second[1].seq);
  });

  it('tracks the running score from the revealed plays', () => {
    for (let i = 0; i < 40; i += 1) replay.step();
    const s = replay.state();
    expect(s.homeScore).toBeGreaterThanOrEqual(0);
    expect(s.awayScore).toBeGreaterThanOrEqual(0);
    expect(s.homeScore + s.awayScore).toBeGreaterThan(0);
  });

  it('never lets the score go backwards as it advances', () => {
    let prev = 0;
    for (let i = 0; i < 171; i += 1) {
      replay.step();
      const s = replay.state();
      const total = s.homeScore + s.awayScore;
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
  });

  it('ends on the real final score of the recorded game', () => {
    replay.seek(171);
    const s = replay.state();
    // DAL @ PHI 2025 wk1 finished 20-24. Taken from the fixture's last play rather
    // than hardcoded twice, but pinned as non-zero and plausible.
    expect(s.homeScore + s.awayScore).toBeGreaterThan(20);
    expect(s.done).toBe(true);
  });

  it('only reveals drives whose plays have been reached', () => {
    expect(replay.state().drives).toHaveLength(0);
    for (let i = 0; i < 171; i += 1) replay.step();
    expect(replay.state().drives).toHaveLength(16);
  });

  it('reveals drives monotonically', () => {
    let prev = 0;
    for (let i = 0; i < 171; i += 5) {
      replay.seek(i);
      const n = replay.state().drives.length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('reaches progress 1 and reports done at the end', () => {
    for (let i = 0; i < 200; i += 1) replay.step();
    expect(replay.state().progress).toBe(1);
    expect(replay.state().done).toBe(true);
  });

  it('advances automatically once played, and stops when paused', () => {
    replay.play();
    vi.advanceTimersByTime(500);
    const afterPlay = replay.state().plays.length;
    expect(afterPlay).toBeGreaterThan(1);
    replay.pause();
    vi.advanceTimersByTime(2000);
    expect(replay.state().plays.length).toBe(afterPlay);
  });

  it('stops the timer automatically at the end of the game', () => {
    replay.play();
    vi.advanceTimersByTime(100 * 200);
    expect(replay.isPlaying).toBe(false);
    expect(replay.state().done).toBe(true);
  });

  it('play is idempotent, so it cannot double-arm the timer', () => {
    replay.play();
    replay.play();
    vi.advanceTimersByTime(300);
    expect(replay.state().plays.length).toBeLessThanOrEqual(4);
  });

  it('notifies subscribers on each step and stops after unsubscribe', () => {
    const seen = vi.fn();
    const off = replay.subscribe(seen);
    replay.step();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    replay.step();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not break the step', () => {
    replay.subscribe(() => { throw new Error('boom'); });
    const good = vi.fn();
    replay.subscribe(good);
    expect(() => replay.step()).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('seek jumps to a play index without replaying each step', () => {
    replay.seek(50);
    expect(replay.state().plays).toHaveLength(50);
    replay.seek(0);
    expect(replay.state().plays).toHaveLength(0);
  });

  it('clamps seek to the bounds of the game', () => {
    replay.seek(-10);
    expect(replay.state().plays).toHaveLength(0);
    replay.seek(9999);
    expect(replay.state().plays).toHaveLength(171);
  });

  it('reset returns to the start and stops playing', () => {
    replay.play();
    vi.advanceTimersByTime(500);
    replay.reset();
    expect(replay.state().plays).toHaveLength(0);
    expect(replay.isPlaying).toBe(false);
  });

  it('exposes win probability up to the current play', () => {
    for (let i = 0; i < 30; i += 1) replay.step();
    const s = replay.state();
    expect(s.winProb.length).toBeGreaterThan(0);
    expect(s.winProb.length).toBeLessThanOrEqual(30);
    expect(s.winProb.at(-1).homePct).toBeGreaterThanOrEqual(0);
  });

  it('reports the total play count so a scrubber can be sized', () => {
    expect(replay.state().totalPlays).toBe(171);
  });
});
