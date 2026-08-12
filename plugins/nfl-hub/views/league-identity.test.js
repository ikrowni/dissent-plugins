// @vitest-environment jsdom
import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

const request = vi.fn();
const requestWithTransfer = vi.fn();
const invokeModule = vi.fn();
vi.mock('../../plugin-sdk.js', () => ({
  request: (...a) => request(...a),
  requestWithTransfer: (...a) => requestWithTransfer(...a),
  invokeModule: (...a) => invokeModule(...a),
  imageUrl: (u) => u,
}));

// ⚠️ THE CROPPER IS STUBBED HERE ON PURPOSE. These tests are about what happens
// to a chosen image — upload, store, discard, and in what order — not about
// framing one. The real dialog needs `URL.createObjectURL` and a canvas, neither
// of which jsdom has; its own maths is covered in core/image-crop.test.js.
// By default it behaves as "the user accepted", returning a cropped blob.
const openCropper = vi.fn();
vi.mock('./crop-dialog.js', () => ({ openCropper: (...a) => openCropper(...a) }));

const {
  renderTeamCard, renderLeagueCard, ownedTeam, reset, rename, pick, clear, _state,
} = await import('./league-identity.js');

/** What the cropper hands back: a WebP blob, as the real one does. */
const cropped = (size = 4096) => ({
  type: 'image/webp',
  size,
  arrayBuffer: async () => new ArrayBuffer(size),
});
const images = await import('../core/team-images.js');

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const ID = '3f2b1a90-7c4d-4e11-9b2a-5d6e7f801234';
const NEW_ID = '99998888-7777-6666-5555-444433332222';

// ⚠️ SHAPED FROM `getLeague` IN server/ops-league.js, field for field — `me` is
// the caller's own verified id and `myTeams` deliberately cannot tell owning from
// co-owning, which is exactly the distinction these cards turn on.
const league = (over = {}) => ({
  id: 'lg1',
  settings: { name: 'Our League' },
  me: 'u-alice',
  myTeams: ['t1'],
  isCommissioner: false,
  bannerFileId: null,
  teams: {
    t1: { id: 't1', name: 'Sunday Scaries', ownerId: 'u-alice', coOwners: [] },
    t2: { id: 't2', name: 'Gridiron Ghosts', ownerId: 'u-bob', coOwners: ['u-alice'] },
  },
  ...over,
});

const app = { router: { refresh: vi.fn() } };
const ctx = (l) => ({ leagueId: 'lg1', league: () => l, reload: vi.fn() });

const file = ({ type = 'image/png', size = 512, name = 'a.png' } = {}) => ({
  name, type, size, arrayBuffer: async () => new ArrayBuffer(size),
});

beforeEach(() => {
  reset();
  images.reset();
  request.mockReset();
  requestWithTransfer.mockReset();
  invokeModule.mockReset();
  app.router.refresh.mockReset();
  openCropper.mockReset();
  openCropper.mockResolvedValue(cropped());
});

describe('ownedTeam', () => {
  // ⚠️ CO-OWNING IS NOT OWNING, and `myTeams` cannot tell them apart — it returns
  // both. Alice co-owns t2; the identity card must never offer to rename it.
  it('finds only the team the caller actually owns', () => {
    expect(ownedTeam(league()).id).toBe('t1');
  });

  it('is null for a co-owner with no team of their own', () => {
    const l = league({ me: 'u-carol', myTeams: ['t2'] });
    l.teams.t2.coOwners = ['u-carol'];
    expect(ownedTeam(l)).toBe(null);
  });

  it('is null before the payload names the caller', () => {
    expect(ownedTeam(league({ me: null }))).toBe(null);
    expect(ownedTeam(undefined)).toBe(null);
  });
});

describe('the team card', () => {
  it('offers a rename field seeded with the current name', () => {
    const el = parse(renderTeamCard(league()));
    const input = el.querySelector('form[data-act="team-rename-form"] input[name="name"]');
    expect(input.value).toBe('Sunday Scaries');
    expect(Number(input.getAttribute('maxlength'))).toBe(60);
  });

  // ⚠️ NOTHING, not an explanatory panel. The League tab already tells a
  // team-less visitor to join, and a second empty card reads as broken.
  it('renders nothing for somebody with no team of their own', () => {
    const l = league({ me: 'u-carol', myTeams: [] });
    expect(renderTeamCard(l)).toBe('');
  });

  it('renders nothing for a co-owner', () => {
    const l = league({ me: 'u-carol', myTeams: ['t2'] });
    l.teams.t2.coOwners = ['u-carol'];
    expect(renderTeamCard(l)).toBe('');
  });

  it('offers an avatar and a banner picker, both accepting only images', () => {
    const el = parse(renderTeamCard(league()));
    const picks = [...el.querySelectorAll('input[type="file"][data-pick]')];
    expect(picks.map((p) => p.dataset.pick).sort()).toEqual(['avatar', 'banner']);
    for (const p of picks) expect(p.getAttribute('accept')).toContain('image/png');
  });

  // ⚠️ NOT `data-act`. core/app.js delegates BOTH click and input to onAction and
  // a file input fires `input` as well as `change`, so a data-act here would
  // upload the same chosen file twice. Delete `data-pick` in favour of `data-act`
  // and this fails.
  it('keeps the file inputs off the hub\'s own action delegation', () => {
    const el = parse(renderTeamCard(league()));
    for (const p of el.querySelectorAll('input[type="file"]')) {
      expect(p.hasAttribute('data-act')).toBe(false);
      expect(p.hasAttribute('data-pick')).toBe(true);
    }
  });

  it('offers Remove only for an image that exists', () => {
    const plain = parse(renderTeamCard(league()));
    expect(plain.querySelector('[data-act="tm-clear"]')).toBe(null);

    const l = league();
    l.teams.t1.avatarFileId = ID;
    const set = parse(renderTeamCard(l));
    const kinds = [...set.querySelectorAll('[data-act="tm-clear"]')].map((b) => b.dataset.kind);
    expect(kinds).toEqual(['avatar']);
  });

  it('shows a refusal inside the card rather than blanking the tab', () => {
    _state.err = 'only the owner of team t1 can do that';
    const el = parse(renderTeamCard(league()));
    expect(el.querySelector('.imp-bad').textContent).toContain('only the owner');
    // The form is still standing — a refusal you cannot see the cause of is worse.
    expect(el.querySelector('form[data-act="team-rename-form"]')).not.toBeNull();
  });

  it('disables every control while one of them is working', () => {
    _state.busy = 'avatar';
    const el = parse(renderTeamCard(league()));
    expect(el.querySelector('button[type="submit"]').disabled).toBe(true);
    for (const p of el.querySelectorAll('input[type="file"]')) expect(p.disabled).toBe(true);
  });

  it('escapes a team name into the value attribute', () => {
    const l = league();
    l.teams.t1.name = '"><script>alert(1)</script>';
    const el = parse(renderTeamCard(l));
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('input[name="name"]').value).toBe('"><script>alert(1)</script>');
  });
});

describe('the league banner card', () => {
  it('is commissioner-only', () => {
    expect(renderLeagueCard(league())).toBe('');
    expect(renderLeagueCard(league({ isCommissioner: true }))).not.toBe('');
  });

  it('picks under its own kind, so it cannot be mistaken for a team banner', () => {
    const el = parse(renderLeagueCard(league({ isCommissioner: true })));
    expect(el.querySelector('input[data-pick]').dataset.pick).toBe('league');
  });
});

describe('rename', () => {
  it('sends the normalized name to the module', async () => {
    invokeModule.mockResolvedValue({ teamId: 't1', name: 'Sunday  Scaries' });
    const c = ctx(league());
    await rename(app, c, { name: '  Sunday   Scaries  ' });
    expect(invokeModule).toHaveBeenCalledWith({
      op: 'team:rename',
      payload: { leagueId: 'lg1', teamId: 't1', name: 'Sunday Scaries' },
    });
    expect(c.reload).toHaveBeenCalled();
  });

  // ⚠️ CHECKED WITH THE MODULE'S OWN RULE, so an obviously-empty field costs no
  // round trip — and cannot disagree with what the module would have said.
  it('refuses an empty name without asking the node', async () => {
    await rename(app, ctx(league()), { name: '   ' });
    expect(invokeModule).not.toHaveBeenCalled();
    expect(_state.err).toMatch(/cannot be empty/i);
  });

  it('shows the module\'s own refusal verbatim', async () => {
    invokeModule.mockRejectedValue(new Error('"X" clashes with team t2 ("X")'));
    await rename(app, ctx(league()), { name: 'X' });
    expect(_state.err).toContain('clashes with team t2');
    expect(_state.busy).toBe(null);
  });
});

describe('pick', () => {
  it('uploads, then points the record at the new id', async () => {
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({ url: 'https://node.example/f.png' });

    await pick(app, ctx(league()), 'avatar', file());

    expect(requestWithTransfer.mock.calls[0][1].attachContext).toBe('team:lg1:t1');
    expect(invokeModule).toHaveBeenCalledWith({
      op: 'team:identity',
      payload: { leagueId: 'lg1', teamId: 't1', avatarFileId: NEW_ID },
    });
  });

  it('routes a league banner to the commissioner op with a league context', async () => {
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({ url: 'https://node.example/f.png' });

    await pick(app, ctx(league({ isCommissioner: true })), 'league', file());

    expect(requestWithTransfer.mock.calls[0][1].attachContext).toBe('league:lg1');
    expect(invokeModule).toHaveBeenCalledWith({
      op: 'league:identity',
      payload: { leagueId: 'lg1', bannerFileId: NEW_ID },
    });
  });

  // ⚠️ ONLY AFTER THE NEW ID IS STORED. Deleting first leaves a team with no
  // picture at all if the module then refuses.
  it('discards the replaced file after the module accepts, never before', async () => {
    const l = league();
    l.teams.t1.avatarFileId = ID;
    const order = [];
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockImplementation(async () => { order.push('store'); return {}; });
    request.mockImplementation(async (action) => { order.push(action); return { url: 'u' }; });

    await pick(app, ctx(l), 'avatar', file());

    expect(order.indexOf('store')).toBeLessThan(order.indexOf('files:delete'));
  });

  it('does not delete the old file when the module refuses', async () => {
    const l = league();
    l.teams.t1.avatarFileId = ID;
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockRejectedValue(new Error('only the owner of team t1 can do that'));

    await pick(app, ctx(l), 'avatar', file());

    expect(request).not.toHaveBeenCalledWith('files:delete', expect.anything());
    expect(_state.err).toMatch(/only the owner/);
  });

  it('reports a refused upload in the card and stores nothing', async () => {
    await pick(app, ctx(league()), 'avatar', file({ type: 'application/pdf' }));
    expect(invokeModule).not.toHaveBeenCalled();
    expect(_state.err).toMatch(/PNG/i);
    expect(_state.busy).toBe(null);
  });

  // ⚠️ A 403 FROM THE DELETE MUST NOT FAIL THE SAVE — only the uploader may
  // delete, so a commissioner replacing somebody else's avatar always gets one.
  it('succeeds even when the old file cannot be deleted', async () => {
    const l = league();
    l.teams.t1.avatarFileId = ID;
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockImplementation(async (action) => {
      if (action === 'files:delete') throw new Error('only the uploader may delete this file');
      return { url: 'https://node.example/f.png' };
    });

    await pick(app, ctx(l), 'avatar', file());
    expect(_state.err).toBe(null);
  });
});

describe('the crop step', () => {
  it.each([
    ['avatar', 'avatar'],
    ['banner', 'teamBanner'],
    ['league', 'leagueBanner'],
  ])('opens the cropper for %s with that surface\'s own shape', async (kind, specKey) => {
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({ url: 'u' });
    await pick(app, ctx(league({ isCommissioner: true })), kind, file());
    expect(openCropper.mock.calls[0][1]).toEqual(images.IMAGE_SPEC[specKey]);
  });

  // ⚠️ CANCELLING IS NOT A FAILURE. Backing out of the dialog must upload
  // nothing, store nothing and report nothing — an error banner for "I changed
  // my mind" is worse than silence.
  it('uploads nothing when the cropper is dismissed', async () => {
    openCropper.mockResolvedValue(null);
    await pick(app, ctx(league()), 'avatar', file());
    expect(requestWithTransfer).not.toHaveBeenCalled();
    expect(invokeModule).not.toHaveBeenCalled();
    expect(_state.err).toBe(null);
    expect(_state.busy).toBe(null);
  });

  // ⚠️ THE RAW FILE IS CHECKED BEFORE THE CROPPER DECODES IT. The crop
  // re-encodes to a small WebP, so a check afterwards never sees the original's
  // size — and decoding a 200 MB photo hangs the tab first anyway.
  it('refuses an oversized ORIGINAL without opening the cropper at all', async () => {
    await pick(app, ctx(league()), 'avatar', file({ size: 21 * 1024 * 1024 }));
    expect(openCropper).not.toHaveBeenCalled();
    expect(_state.err).toMatch(/limit is/i);
  });

  it('refuses a non-image without opening the cropper', async () => {
    await pick(app, ctx(league()), 'avatar', file({ type: 'application/pdf' }));
    expect(openCropper).not.toHaveBeenCalled();
    expect(_state.err).toMatch(/PNG/i);
  });

  // ⚠️ A Blob HAS NO `name`, and the node stores the filename it is given — a
  // bare blob lands as "undefined". The extension has to follow the real type.
  it('names the cropped blob before uploading it', async () => {
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({ url: 'u' });
    await pick(app, ctx(league()), 'avatar', file());
    expect(requestWithTransfer.mock.calls[0][1].name).toBe('avatar.webp');
  });

  // ⚠️ The dialog waits on a PERSON. Disabling the card and showing "Uploading…"
  // for as long as they take to frame the picture would be a lie about what is
  // happening, and nothing is spent until they accept.
  it('does not enter the busy state while the dialog is open', async () => {
    let busyDuringDialog;
    openCropper.mockImplementation(async () => { busyDuringDialog = _state.busy; return cropped(); });
    requestWithTransfer.mockResolvedValue({ id: NEW_ID });
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({ url: 'u' });
    await pick(app, ctx(league()), 'avatar', file());
    expect(busyDuringDialog).toBe(null);
  });
});

describe('clear', () => {
  // ⚠️ '' IS THE MODULE'S DELIBERATE "REMOVE THIS". Omitting the field would mean
  // "leave it alone" and the image would silently stay.
  it('sends an empty string, not an omitted field', async () => {
    const l = league();
    l.teams.t1.bannerFileId = ID;
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({});

    await clear(app, ctx(l), 'banner');

    expect(invokeModule).toHaveBeenCalledWith({
      op: 'team:identity',
      payload: { leagueId: 'lg1', teamId: 't1', bannerFileId: '' },
    });
  });

  it('clears the league banner through the commissioner op', async () => {
    invokeModule.mockResolvedValue({});
    request.mockResolvedValue({});
    await clear(app, ctx(league({ isCommissioner: true, bannerFileId: ID })), 'league');
    expect(invokeModule).toHaveBeenCalledWith({
      op: 'league:identity',
      payload: { leagueId: 'lg1', bannerFileId: '' },
    });
  });
});
