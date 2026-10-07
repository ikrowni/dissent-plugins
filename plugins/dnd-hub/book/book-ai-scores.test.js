import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../plugin-sdk.js', () => ({ request: vi.fn() }));
vi.mock('./book-snippets.js', () => ({ regionPng: vi.fn(async () => new Blob(['png'])) }));
const { scoresFromReading, needsScores, readMissingScores } = await import('./book-ai-scores.js');
const { request } = await import('../../plugin-sdk.js');

// Real readings from the spike (Florence-2, 8-bit, Ravenloft / Strahd / SRD strips), with the page's truth.
describe('scoresFromReading', () => {
  it('takes a clean row', () => {
    expect(scoresFromReading('STRDEXCONINTWISCHA12 (+1)9 (-1)10 (+0)11 (+0)13 (+1)9 (-1)')).toEqual([12, 9, 10, 11, 13, 9]);
    expect(scoresFromReading('STRDEXCONINTWISCHA21 (+5) 9 (-1) 15 (+2) 18 (+4) 15 (+2) 18 (+4)')).toEqual([21, 9, 15, 18, 15, 18]);
  });

  it('ignores a minus read as a plus (the scores are right)', () => {
    // Ravenloft p205: 8 (-1) 13 (+1) 12 (+1) 11 (+0) 12 (+1) 9 (-1) — the last read as "(+1)".
    expect(scoresFromReading('STRDEXCONINTWISCHA8 (-1)13 (+1)12 (+1)11 (+0)12 (+1)9 (+1)')).toEqual([8, 13, 12, 11, 12, 9]);
    expect(scoresFromReading('STRDEXCONINTWISCHA16 (+3)14 (+2)15 (+2)1 (+5)10 (+0)1 (+5)')).toEqual([16, 14, 15, 1, 10, 1]);
  });

  it('🔴 refuses a row with a value repeated — the first six would be wrong', () => {
    // Ravenloft p231, truth 18 8 20 14 14 18: read with an extra "14 (2)".
    expect(scoresFromReading('STRDEXCONINTWISCHA18 (4)8 (1)20 (5)14 (2)14 (2)14 (2)18 (4)')).toBeNull();
    // Truth 15 11 14 10 10 10: "11" read as "17" and an extra "10 (+0)".
    expect(scoresFromReading('STRDEXCONINTWISCHA15 (+2)17 (+0)14 (+2)10 (+0)10 (+0)10 (+0)10 (+0)')).toBeNull();
    // SRD truth 18 18 18 17 20 20: four 18s.
    expect(scoresFromReading('STRDEXCONINTWISCHA18 (+4) 18 (+4) 18 (+4) 18 (+4) 17 (+3) 20 (+5) 20 (+5)')).toBeNull();
  });

  it('refuses a misread score whose modifier does not fit, and garbage', () => {
    expect(scoresFromReading('STRDEXCONINTWISCHA15 (+2)17 (+0)14 (+2)10 (+0)10 (+0)10 (+0)')).toBeNull();
    expect(scoresFromReading('SDREX CONINTSCHA')).toBeNull();
    expect(scoresFromReading('STRDEXCONINTWISCHA1344 10-0 12-1 8-1 11-0 9-1')).toBeNull();
    expect(scoresFromReading(null)).toBeNull();
  });
});

describe('readMissingScores', () => {
  beforeEach(() => request.mockReset());
  const src = { page: 205, x0: 72, x1: 271, top: 201, bottom: 236, fromTop: true };
  const creature = (over = {}) => ({ id: 'acolyte', name: 'Acolyte', scan: true, scoreSrc: src, str: null, dex: null, con: null,
    int: null, wis: null, cha: null, ac: 10, hp: 9, hp_dice: '2d8', cr: 0.25, actions: [{ name: 'Club' }], ...over });

  it('fills the scores the reading checks, marks them, and drops the strip', async () => {
    request.mockResolvedValueOnce({ available: true, text: 'STR DEX CON INT WIS CHA 10 (+0) 10 (+0) 10 (+0) 10 (+0) 14 (+2) 11 (+0)' });
    const list = [creature(), { id: 'done', str: 10 }];
    const notes = [];
    const r = await readMissingScores(list, () => new Blob(['pdf']), t => notes.push(t));
    expect(r).toEqual({ read: 1, of: 1, why: null });
    expect(list[0]).toMatchObject({ str: 10, wis: 14, cha: 11, aiScores: true });
    expect(list[0].scoreSrc).toBeUndefined();
    expect(list[0].problems).not.toContain('ability scores not read');
    expect(notes).toEqual(['Reading scores… 1 of 1']);
  });

  const trim = vi.fn(async () => new Blob(['trimmed']));

  it('tries the trimmed strip when the first reading does not check, and takes it if it does', async () => {
    request.mockResolvedValueOnce({ available: true, text: '18 (4)8 (1)20 (5)14 (2)14 (2)14 (2)18 (4)' })
      .mockResolvedValueOnce({ available: true, text: '10 (+0) 10 (+0) 10 (+0) 10 (+0) 14 (+2) 11 (+0)' });
    const list = [creature()];
    expect(await readMissingScores(list, () => new Blob(['pdf']), () => {}, undefined, trim)).toEqual({ read: 1, of: 1, why: null });
    expect(request.mock.calls.at(-1)[1].image).toEqual(new Blob(['trimmed']));
    expect(list[0].str).toBe(10);
  });

  it('leaves a creature alone when neither reading checks', async () => {
    request.mockResolvedValueOnce({ available: true, text: '18 (4)8 (1)20 (5)14 (2)14 (2)14 (2)18 (4)' })
      .mockResolvedValueOnce({ available: true, text: 'SDREX' });
    const list = [creature()];
    expect(await readMissingScores(list, () => new Blob(['pdf']), () => {}, undefined, trim)).toEqual({ read: 0, of: 1, why: null });
    expect(list[0].str).toBeNull();
    expect(list[0].scoreSrc).toBe(src);
  });

  it('stops with the reason when on-device AI cannot run', async () => {
    request.mockResolvedValueOnce({ available: false, why: 'the page model is not downloaded' });
    const r = await readMissingScores([creature(), creature({ id: 'b' })], () => new Blob(['pdf']), () => {});
    expect(r.why).toBe('On-device AI is not available: the page model is not downloaded.');
    request.mockRejectedValueOnce(new Error('permission not granted: ai:read'));
    expect((await readMissingScores([creature()], () => new Blob(['pdf']), () => {})).why).toMatch(/not been allowed/);
  });

  it('only creatures with a placed, unread score row', () => {
    expect(needsScores([creature(), creature({ scoreSrc: undefined }), creature({ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 })])).toHaveLength(1);
  });
});
