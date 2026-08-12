import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';

// ⚠️ THE HOST IS STUBBED FROM ITS REAL CONTRACT, not invented. `request` resolves
// the `data` half of the capability reply and REJECTS on refusal — that is what
// plugin-sdk.js does — so a stub that resolved `{ ok: false }` would let code
// pass here that throws in the browser.
const request = vi.fn();
const requestWithTransfer = vi.fn();
vi.mock('../../plugin-sdk.js', () => ({
  request: (...a) => request(...a),
  requestWithTransfer: (...a) => requestWithTransfer(...a),
}));

const {
  resolve, urlFor, reset, uploadImage, discard, contextFor,
  MAX_IMAGE_BYTES, ACCEPT_ATTR, IMAGE_SPEC, specHint,
} = await import('./team-images.js');

const ID = '3f2b1a90-7c4d-4e11-9b2a-5d6e7f801234';
const ID2 = '11112222-3333-4444-5555-666677778888';

// A stand-in for the browser File the picker hands over. Only the four fields the
// uploader reads are needed, and `arrayBuffer` is what it transfers.
const fakeFile = ({ type = 'image/png', size = 1024, name = 'a.png' } = {}) => ({
  name, type, size, arrayBuffer: async () => new ArrayBuffer(size),
});

beforeEach(() => {
  reset();
  request.mockReset();
  requestWithTransfer.mockReset();
  vi.useRealTimers();
});

describe('urlFor', () => {
  it('is null for an unresolved id, and never throws', () => {
    expect(urlFor(ID)).toBe(null);
    expect(urlFor('')).toBe(null);
    expect(urlFor(undefined)).toBe(null);
  });

  it('returns a resolved url', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID]);
    expect(urlFor(ID)).toBe('https://node.example/f.png');
  });

  // ⚠️ THE NODE SIGNS FOR 15 MINUTES. A cache that outlived the signature would
  // hand an <img> a URL that is already dead — a broken picture with nothing in
  // the code saying why.
  it('forgets a url before the node\'s signature expires', async () => {
    vi.useFakeTimers();
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID]);
    expect(urlFor(ID)).not.toBe(null);
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(urlFor(ID)).toBe(null);
  });
});

describe('resolve', () => {
  it('asks the node once per id and reports that something arrived', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    expect(await resolve([ID, ID2])).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('files:getUrl', { fileId: ID });
  });

  it('does not ask again for something already cached', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID]);
    request.mockClear();
    expect(await resolve([ID])).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  // ⚠️ TWELVE STANDINGS ROWS, ONE REQUEST. Without the in-flight map a league
  // whose teams share a banner would ask for it once per row.
  it('collapses duplicate ids in one batch', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID, ID, ID, '']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  // ⚠️ A DELETED BANNER MUST NOT BLANK A LEAGUE. This is the whole reason
  // `resolve` swallows: it is awaited inside league-home's load, and a rejection
  // there lands in the error pane that replaces the entire tab.
  it('never rejects when the node refuses', async () => {
    request.mockRejectedValue(new Error('file not found'));
    await expect(resolve([ID])).resolves.toBe(false);
    expect(urlFor(ID)).toBe(null);
  });

  it('survives a reply with no url', async () => {
    request.mockResolvedValue({});
    expect(await resolve([ID])).toBe(false);
  });

  it('keeps the ids that DID resolve when one of them fails', async () => {
    request.mockImplementation((_a, { fileId }) => (fileId === ID
      ? Promise.reject(new Error('gone'))
      : Promise.resolve({ url: 'https://node.example/ok.png' })));
    expect(await resolve([ID, ID2])).toBe(true);
    expect(urlFor(ID)).toBe(null);
    expect(urlFor(ID2)).toBe('https://node.example/ok.png');
  });

  it('does nothing at all for an empty list', async () => {
    expect(await resolve([])).toBe(false);
    expect(await resolve(undefined)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('uploadImage', () => {
  it('sends the bytes with a context and returns the id', async () => {
    requestWithTransfer.mockResolvedValue({ id: ID, url: 'https://storage.example/x.png' });
    const id = await uploadImage(fakeFile(), { context: 'team:lg:t1' });
    expect(id).toBe(ID);
    const [action, params, transfers, timeout] = requestWithTransfer.mock.calls[0];
    expect(action).toBe('files:upload');
    expect(params.attachContext).toBe('team:lg:t1');
    expect(params.data).toBeInstanceOf(ArrayBuffer);
    // ⚠️ TRANSFERRED, not copied — and the timeout is the interactive one. The
    // default 10s kills a healthy 3 MB upload on a slow connection.
    expect(transfers[0]).toBe(params.data);
    expect(timeout).toBeGreaterThanOrEqual(120000);
  });

  // ⚠️ THE RETURNED URL IS A STORAGE-ORIGIN URL. It is blocked by the plugin CSP
  // and 403s against a private bucket, so nothing may ever store or return it.
  it('discards the url the upload returns', async () => {
    requestWithTransfer.mockResolvedValue({ id: ID, url: 'https://storage.example/x.png' });
    const out = await uploadImage(fakeFile(), { context: 'league:lg' });
    expect(out).toBe(ID);
    expect(String(out)).not.toContain('storage.example');
  });

  // ⚠️ WITHOUT A CONTEXT THE FILE IS SWEPT AS ABANDONED AFTER SEVEN DAYS, and the
  // banner silently disappears a week after it was set. Refusing locally is the
  // only place that can be caught.
  it('refuses to upload with no attach context', async () => {
    await expect(uploadImage(fakeFile(), { context: '' })).rejects.toThrow(/context/i);
    expect(requestWithTransfer).not.toHaveBeenCalled();
  });

  it('refuses a file type the node would reject anyway', async () => {
    await expect(uploadImage(fakeFile({ type: 'application/pdf' }), { context: 'league:lg' }))
      .rejects.toThrow(/PNG/i);
    expect(requestWithTransfer).not.toHaveBeenCalled();
  });

  it('refuses an oversized image before spending the member\'s quota on it', async () => {
    const big = fakeFile({ size: MAX_IMAGE_BYTES + 1 });
    await expect(uploadImage(big, { context: 'league:lg' })).rejects.toThrow(/limit is/i);
    expect(requestWithTransfer).not.toHaveBeenCalled();
  });

  it('accepts exactly the limit', async () => {
    requestWithTransfer.mockResolvedValue({ id: ID });
    await expect(uploadImage(fakeFile({ size: MAX_IMAGE_BYTES }), { context: 'league:lg' }))
      .resolves.toBe(ID);
  });

  it('refuses a reply with no id rather than storing undefined', async () => {
    requestWithTransfer.mockResolvedValue({ url: 'https://storage.example/x.png' });
    await expect(uploadImage(fakeFile(), { context: 'league:lg' })).rejects.toThrow(/file id/i);
  });

  it('offers exactly the image types the node stores', () => {
    expect(ACCEPT_ATTR.split(',').sort())
      .toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('discard', () => {
  // ⚠️ ONLY THE UPLOADER MAY DELETE. A commissioner replacing somebody else's
  // avatar gets a 403 here, and that must never turn a successful save into a
  // failed one.
  it('swallows a refusal', async () => {
    request.mockRejectedValue(new Error('only the uploader may delete this file'));
    await expect(discard(ID)).resolves.toBeUndefined();
  });

  it('drops the cached url so a replaced image cannot linger on screen', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID]);
    request.mockResolvedValue({});
    await discard(ID);
    expect(urlFor(ID)).toBe(null);
  });

  it('does nothing for an empty id', async () => {
    await discard('');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('IMAGE_SPEC', () => {
  // ⚠️ THE RATIO IS STATED TWICE — once here for the copy, once in league.css for
  // the layout — and if they disagree the hint advertises a size that then gets
  // cropped, which is precisely the failure the hint exists to prevent. Same
  // mirrored-list hazard scripts/audit/mirrored-lists.mjs guards elsewhere.
  const css = readFileSync(
    new URL('../styles/league.css', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it.each([
    ['tm-banner-league', 'leagueBanner'],
    ['tm-banner-team', 'teamBanner'],
  ])('%s matches IMAGE_SPEC.%s', (cls, key) => {
    const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*aspect-ratio:\\s*([^;}]+)`).exec(css);
    expect(rule, `no aspect-ratio rule for .${cls}`).not.toBeNull();
    expect(rule[1].trim()).toBe(IMAGE_SPEC[key].ratio);
  });

  // The recommended pixel size must actually BE the ratio it is sold as.
  it.each(Object.entries(IMAGE_SPEC))('%s: the recommended size is that ratio', (_k, spec) => {
    const [w, h] = spec.best.split('×').map((n) => Number(n.trim()));
    const [rw, rh] = spec.ratio.split('/').map((n) => Number(n.trim()));
    expect(w / h).toBeCloseTo(rw / rh, 2);
  });

  // ⚠️ The frame is ~1530px wide with the member list collapsed, so a banner
  // narrower than that is visibly soft on the surface it was made for.
  it.each(['teamBanner', 'leagueBanner'])('%s is wide enough for the real frame', (key) => {
    expect(Number(IMAGE_SPEC[key].best.split('×')[0].trim())).toBeGreaterThanOrEqual(1530);
  });

  it('gives every picker a hint naming both the shape and the crop', () => {
    for (const key of Object.keys(IMAGE_SPEC)) {
      const hint = specHint(key);
      expect(hint).toContain(IMAGE_SPEC[key].best);
      expect(hint).toMatch(/cropped/i);
    }
    // An unknown key must render nothing rather than "undefined".
    expect(specHint('nope')).toBe('');
  });
});

describe('contextFor', () => {
  // ⚠️ ONE DEFINITION. `files:releaseContext` reclaims by exact string, so a
  // second spelling anywhere means files that are never reclaimed.
  it('scopes a team context to its league', () => {
    expect(contextFor.team('lg1', 't1')).toBe('team:lg1:t1');
    expect(contextFor.league('lg1')).toBe('league:lg1');
  });
});

describe('reset', () => {
  it('drops every resolved url', async () => {
    request.mockResolvedValue({ url: 'https://node.example/f.png' });
    await resolve([ID]);
    reset();
    expect(urlFor(ID)).toBe(null);
  });
});
