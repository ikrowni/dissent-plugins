import { describe, it, expect } from 'vitest';
import { cleanNextSession, cleanVote, voteKey, tally, chosenOption, reminderDue, untilText, postText, MAX_OPTIONS } from './lk-schedule.js';

const H = 3600000, DAY = 24 * H;
const now = Date.UTC(2026, 9, 7, 12, 0);

describe('the DM\'s question', () => {
  it('keeps up to four future times, in order, and a short note', () => {
    const s = cleanNextSession({ id: 's1', note: 'x'.repeat(400), options: [
      { id: 'c', at: now + 3 * DAY }, { id: 'a', at: now + DAY }, { id: 'old', at: now - H },
      { id: 'b', at: now + 2 * DAY }, { id: 'd', at: now + 4 * DAY }, { id: 'e', at: now + 5 * DAY }, { id: 'bad', at: 'soon' },
    ] }, now);
    expect(s.options.map(o => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.options).toHaveLength(MAX_OPTIONS);
    expect(s.note).toHaveLength(200);
    expect(s.chosenId).toBeNull();
  });
  it('drops a chosen time that is not one of the options', () => {
    expect(cleanNextSession({ id: 's', options: [{ id: 'a', at: now + H }], chosenId: 'zz' }, now).chosenId).toBeNull();
    expect(cleanNextSession({ id: 's', options: [{ id: 'a', at: now + H }], chosenId: 'a' }, now).chosenId).toBe('a');
  });
  it('keeps a chosen time even once it has passed (the session is today)', () => {
    const s = cleanNextSession({ id: 's', options: [{ id: 'a', at: now - H }], chosenId: 'a' }, now);
    expect(s.options.map(o => o.id)).toEqual(['a']);
  });
  it('is nothing without an id', () => expect(cleanNextSession({ options: [] }, now)).toBeNull());
});

describe('votes', () => {
  const ns = cleanNextSession({ id: 's1', options: [{ id: 'a', at: now + DAY }, { id: 'b', at: now + 2 * DAY }] }, now);
  it('one key per player per question', () => expect(voteKey('c1', 's1', 'u1')).toBe('sched-vote-c1-s1-u1'));
  it('a vote only names this question\'s times', () => {
    expect(cleanVote({ sessionId: 's1', picks: ['a', 'zz', 'a'], name: 'Bob' }, ns)).toEqual({ sessionId: 's1', picks: ['a'], name: 'Bob' });
    expect(cleanVote({ sessionId: 'old', picks: ['a'] }, ns)).toBeNull();
  });
  it('counts who can make each time, best first by count then date', () => {
    const t = tally(ns, { u1: { sessionId: 's1', picks: ['a', 'b'], name: 'Bob' }, u2: { sessionId: 's1', picks: ['b'], name: 'Cat' } });
    expect(t.map(o => [o.id, o.names])).toEqual([['a', ['Bob']], ['b', ['Bob', 'Cat']]]);
    expect(t.find(o => o.best).id).toBe('b');
  });
  it('has no best time before anyone votes', () => expect(tally(ns, {}).some(o => o.best)).toBe(false));
});

describe('reminders and words', () => {
  const ns = cleanNextSession({ id: 's1', options: [{ id: 'a', at: now + 20 * H }], chosenId: 'a' }, now);
  it('is due within a day of the session, once', () => {
    expect(chosenOption(ns).id).toBe('a');
    expect(reminderDue(ns, now, null)).toBe(true);
    expect(reminderDue(ns, now, 's1')).toBe(false);
    expect(reminderDue({ ...ns, options: [{ id: 'a', at: now + 30 * H }] }, now, null)).toBe(false);
    expect(reminderDue({ ...ns, options: [{ id: 'a', at: now - H }] }, now, null)).toBe(false);
    expect(reminderDue({ ...ns, chosenId: null }, now, null)).toBe(false);
  });
  it('says how long until in plain words', () => {
    expect(untilText(now + 2 * DAY + 5 * H, now)).toBe('in 2 days');
    expect(untilText(now + 5 * H + 20 * 60000, now)).toBe('in 5 h 20 min');
    expect(untilText(now + 30 * 60000, now)).toBe('in 30 min');
    expect(untilText(now - H, now)).toBe('now');
  });
  it('writes the posts for the channel', () => {
    const when = 'Thu 8 Oct, 08:00 (DM\'s time, UTC+1)';
    expect(postText('ask', { campaignName: 'Strahd', count: 3 })).toMatch(/Strahd.*3 times.*Open LanternKeep/s);
    expect(postText('chosen', { campaignName: 'Strahd', when })).toBe(`📅 **Strahd** — next session: ${when}. Open LanternKeep to see it in your own time.`);
    expect(postText('reminder', { campaignName: 'Strahd', when })).toBe(`⏰ **Strahd** — less than a day to go: ${when}.`);
  });
});
