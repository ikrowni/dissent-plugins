import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../plugin-sdk.js', () => ({ request: vi.fn() }));
const { boxesFromRegions, findPictures, _forgetFound } = await import('./book-ai-regions.js');
const { request } = await import('../../plugin-sdk.js');

describe('boxesFromRegions', () => {
  it('keeps real boxes as rects', () => {
    // Heliana p400, "ink drawing": three pieces of art.
    const r = boxesFromRegions([{ x: 0.101, y: 0.538, w: 0.811, h: 0.396 }, { x: 0.111, y: 0.088, w: 0.395, h: 0.44 }, { x: 0.56, y: 0.308, w: 0.346, h: 0.208 }]);
    expect(r).toEqual([[0.101, 0.538, 0.811, 0.396], [0.111, 0.088, 0.395, 0.44], [0.56, 0.308, 0.346, 0.208]]);
  });

  it('drops a whole-page box, a speck, and a box inside a bigger one', () => {
    expect(boxesFromRegions([{ x: 0.001, y: 0.001, w: 0.998, h: 0.998 }])).toEqual([]);
    expect(boxesFromRegions([{ x: 0.5, y: 0.5, w: 0.05, h: 0.05 }])).toEqual([]);
    // Heliana p595: the painting, and the goblin's half of it found again.
    expect(boxesFromRegions([{ x: 0.001, y: 0.171, w: 0.533, h: 0.821 }, { x: 0.001, y: 0.171, w: 0.461, h: 0.384 }])).toEqual([[0.001, 0.171, 0.533, 0.821]]);
  });

  it('clamps to the page and ignores rubbish', () => {
    expect(boxesFromRegions([{ x: 0.8, y: -0.2, w: 0.5, h: 0.5 }])).toEqual([[0.8, 0, 0.2, 0.5]]);
    expect(boxesFromRegions(null)).toEqual([]);
    expect(boxesFromRegions([{ x: 'a' }])).toEqual([]);
  });
});

describe('findPictures', () => {
  beforeEach(() => { request.mockReset(); _forgetFound(); });
  const page = vi.fn(async () => new Blob(['page']));

  it('asks once per page and remembers the answer this session', async () => {
    request.mockResolvedValue({ available: true, regions: [{ x: 0.5, y: 0.1, w: 0.4, h: 0.5 }] });
    expect(await findPictures('b1', { doc: 0, page: 7 }, page)).toEqual({ rects: [[0.5, 0.1, 0.4, 0.5]] });
    expect(await findPictures('b1', { doc: 0, page: 7 }, page)).toEqual({ rects: [[0.5, 0.1, 0.4, 0.5]] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('ai.regions');
  });

  it('says why when it cannot run', async () => {
    request.mockResolvedValueOnce({ available: false, why: 'the page model is not downloaded' });
    expect(await findPictures('b1', { doc: 0, page: 8 }, page)).toEqual({ why: 'On-device AI is not available: the page model is not downloaded.' });
    request.mockRejectedValueOnce(new Error('unknown action: ai.regions'));
    expect((await findPictures('b1', { doc: 0, page: 9 }, page)).why).toBe('Update the Dissent app to use on-device AI.');
  });
});
