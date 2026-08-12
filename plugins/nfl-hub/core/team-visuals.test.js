// @vitest-environment jsdom
import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

const request = vi.fn();
vi.mock('../../plugin-sdk.js', () => ({
  request: (...a) => request(...a),
  requestWithTransfer: vi.fn(),
  imageUrl: (u) => u,
}));

const { resolve, reset } = await import('./team-images.js');
const { teamAvatar, teamMark, banner, imageIdsOf } = await import('./team-visuals.js');
const { managerColor } = await import('./player-visuals.js');

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const ID = '3f2b1a90-7c4d-4e11-9b2a-5d6e7f801234';

const withUrl = async (id, url = 'https://node.example/f.png') => {
  request.mockResolvedValue({ url });
  await resolve([id]);
};

beforeEach(() => { reset(); request.mockReset(); });

describe('teamAvatar', () => {
  // ⚠️ THE STATE EVERY TEAM STARTS IN, and the one most stay in all season.
  it('draws a monogram when nothing has been uploaded', () => {
    const el = parse(teamAvatar({ id: 't1', name: 'Sunday Scaries' }));
    const a = el.querySelector('.tm-avatar');
    expect(a).not.toBeNull();
    expect(a.querySelector('img')).toBeNull();
    expect(a.textContent.trim()).toBe('SS');
  });

  it('draws the image once its url has resolved', async () => {
    await withUrl(ID);
    const el = parse(teamAvatar({ id: 't1', name: 'Sunday Scaries', avatarFileId: ID }));
    expect(el.querySelector('.tm-avatar img').getAttribute('src')).toBe('https://node.example/f.png');
  });

  // ⚠️ THE MONOGRAM STAYS UNDERNEATH. The URL is signed and expires, so an image
  // that 403s mid-session must fall back to initials, not to a broken-image glyph
  // — the `onerror` removes only the img and this is what is left standing.
  it('keeps the monogram behind the image', async () => {
    await withUrl(ID);
    const el = parse(teamAvatar({ id: 't1', name: 'Sunday Scaries', avatarFileId: ID }));
    expect(el.querySelector('.tm-mono').textContent).toBe('SS');
    expect(el.querySelector('.tm-avatar img').getAttribute('onerror')).toContain('remove');
  });

  // ⚠️ FALLS BACK, DOES NOT WAIT. A render happening before resolution finishes
  // must produce a team, not a hole — this is why urlFor is a sync cache read.
  it('falls back to the monogram while an id is still unresolved', () => {
    const el = parse(teamAvatar({ id: 't1', name: 'Sunday Scaries', avatarFileId: ID }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent.trim()).toBe('SS');
  });

  // ⚠️ THE COLOUR SURVIVES THE AVATAR. managerColor is what makes a standings
  // table readable before anybody uploads anything, and an avatar is an upgrade
  // on it rather than a replacement — so the ring carries the hue either way.
  it('carries the manager colour with and without an image', async () => {
    const team = { id: 't7', name: 'Gridiron Ghosts' };
    const colour = managerColor('t7');
    expect(parse(teamAvatar(team)).querySelector('.tm-avatar').style.getPropertyValue('--tm'))
      .toBe(colour);
    await withUrl(ID);
    const lit = parse(teamAvatar({ ...team, avatarFileId: ID })).querySelector('.tm-avatar');
    expect(lit.style.getPropertyValue('--tm')).toBe(colour);
  });

  // ⚠️ SAME BOX EITHER WAY, so a list does not reflow as avatars resolve.
  it('renders at the requested size in both states', async () => {
    const plain = parse(teamAvatar({ id: 't1', name: 'A B' }, { size: 40 }));
    await withUrl(ID);
    const lit = parse(teamAvatar({ id: 't1', name: 'A B', avatarFileId: ID }, { size: 40 }));
    for (const el of [plain, lit]) {
      const s = el.querySelector('.tm-avatar').style;
      expect(s.width).toBe('40px');
      expect(s.height).toBe('40px');
    }
  });

  it('survives a team with no name and no id', () => {
    expect(() => parse(teamAvatar(undefined))).not.toThrow();
    expect(parse(teamAvatar(undefined)).querySelector('.tm-avatar')).not.toBeNull();
  });

  // A team name is user input, rendered into every other manager's DOM.
  it('escapes the name it draws initials from', () => {
    const el = parse(teamAvatar({ id: 't1', name: '<img src=x onerror=alert(1)>' }));
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('teamMark', () => {
  it('pairs the avatar with the name', () => {
    const el = parse(teamMark({ id: 't1', name: 'Sunday Scaries' }));
    expect(el.querySelector('.tm-avatar')).not.toBeNull();
    expect(el.querySelector('.tm-name').textContent).toBe('Sunday Scaries');
  });

  it('escapes the name', () => {
    const el = parse(teamMark({ id: 't1', name: '<b>bold</b>' }));
    expect(el.querySelector('.tm-name').querySelector('b')).toBeNull();
    expect(el.querySelector('.tm-name').textContent).toBe('<b>bold</b>');
  });

  it('appends the caller\'s own trusted markup after the name', () => {
    const el = parse(teamMark({ id: 't1', name: 'X' }, { extra: '<span class="you">you</span>' }));
    expect(el.querySelector('.you')).not.toBeNull();
  });

  it('falls back to the id when there is no name', () => {
    expect(parse(teamMark({ id: 't4' })).querySelector('.tm-name').textContent).toBe('t4');
  });
});

describe('banner', () => {
  // ⚠️ ABSENT, NOT EMPTY. A placeholder band above every league that has not set
  // one would be a permanent grey scar on the most-visited pane in the section.
  it('renders nothing at all with no banner', () => {
    expect(banner(undefined)).toBe('');
    expect(banner('')).toBe('');
  });

  it('renders nothing while the id is unresolved', () => {
    expect(banner(ID)).toBe('');
  });

  it('renders the image once resolved, with the caller\'s class', async () => {
    await withUrl(ID, 'https://node.example/b.png');
    const el = parse(banner(ID, { className: 'tm-banner-league' }));
    expect(el.querySelector('.tm-banner.tm-banner-league')).not.toBeNull();
    expect(el.querySelector('img').getAttribute('src')).toBe('https://node.example/b.png');
  });

  // A banner that 403s must take its own band with it, not leave an empty box.
  it('removes the whole band if the image fails', async () => {
    await withUrl(ID);
    const el = parse(banner(ID));
    expect(el.querySelector('img').getAttribute('onerror')).toContain('tm-banner');
  });
});

describe('imageIdsOf', () => {
  // ⚠️ ONE PLACE THAT KNOWS WHERE IMAGES LIVE ON A LEAGUE. A view assembling its
  // own list would silently stop resolving anything a later field added.
  it('collects the league banner and every team image', () => {
    const ids = imageIdsOf({
      bannerFileId: 'lg-banner',
      teams: {
        t1: { id: 't1', avatarFileId: 'a1', bannerFileId: 'b1' },
        t2: { id: 't2', avatarFileId: 'a2' },
        t3: { id: 't3' },
      },
    });
    expect(ids.sort()).toEqual(['a1', 'a2', 'b1', 'lg-banner']);
  });

  it('drops absent ids rather than passing empty strings to the node', () => {
    expect(imageIdsOf({ bannerFileId: '', teams: { t1: { avatarFileId: null } } })).toEqual([]);
  });

  it('survives a league that has not loaded', () => {
    expect(imageIdsOf(undefined)).toEqual([]);
    expect(imageIdsOf({})).toEqual([]);
  });
});
