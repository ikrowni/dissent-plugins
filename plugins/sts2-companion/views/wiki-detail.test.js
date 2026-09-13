// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
const saves = vi.fn();
vi.mock('../core/host.js', () => ({ store, saves }));
const { renderDetail } = await import('./wiki-detail.js');

// process.cwd(), not import.meta.url: under jsdom the module URL is not a file: URL.
const load = async (n) => JSON.parse(readFileSync(`${process.cwd()}/plugins/sts2-companion/data/${n}.json`));
const make = (over = {}) => ({ data: createData({ load }), art: { url: vi.fn(async () => 'blob:x') }, open: vi.fn(), ...over });

beforeEach(() => { store.get.mockReset().mockResolvedValue(null); store.set.mockReset(); saves.mockReset().mockResolvedValue({ status: 'desktop_only' }); });

describe('a card page', () => {
  it('shows the card, its text, and toggles to the upgraded version', async () => {
    const el = await renderDetail({ kind: 'card', id: 'BASH' }, make());
    document.body.replaceChildren(el);
    expect(el.querySelector('h1').textContent).toBe('Bash');
    const text = () => el.querySelector('.card-text').textContent;
    expect(text()).toContain('8');
    el.querySelector('[data-act="upgrade"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(text()).toContain('10');
    // No upgraded images ship (the 16 MB plugin cap), so the base art is marked instead.
    expect(el.querySelector('.card-art').classList.contains('upgraded')).toBe(true);
  });

  it('links game terms to their pages', async () => {
    const c = make();
    const el = await renderDetail({ kind: 'card', id: 'BASH' }, c);
    el.querySelector('[data-term="Vulnerable"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'power' }));
  });

  it('shows your own stats on desktop', async () => {
    saves.mockResolvedValue({ status: 'ok', cards: [{ id: 'CARD.BASH', picked: 3, skipped: 1, won: 5, lost: 7 }] });
    const el = await renderDetail({ kind: 'card', id: 'BASH' }, make());
    expect(el.querySelector('.your-stats').textContent).toMatch(/5.*won/i);
  });

  it('says nothing about stats on web rather than showing zeros', async () => {
    const el = await renderDetail({ kind: 'card', id: 'BASH' }, make());
    expect(el.querySelector('.your-stats')).toBeNull();
  });

  it('bookmarks and un-bookmarks', async () => {
    const el = await renderDetail({ kind: 'card', id: 'BASH' }, make());
    el.querySelector('[data-act="bookmark"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.set).toHaveBeenCalledWith('bookmarks', ['card:BASH']);
  });
});

describe('an enemy page', () => {
  it('lays out the move pattern with its moves', async () => {
    const monsters = await load('monsters');
    const withPattern = monsters.find((m) => m.pattern?.states?.length);
    const el = await renderDetail({ kind: 'monster', id: withPattern.id }, make());
    expect(el.querySelectorAll('.pattern li').length).toBeGreaterThan(0);
    expect(el.textContent).toContain(withPattern.moves[0].name);
  });
});

describe('an unknown id', () => {
  it('renders the raw id plainly', async () => {
    const el = await renderDetail({ kind: 'card', id: 'NOT_A_CARD' }, make());
    expect(el.textContent).toContain('NOT_A_CARD');
  });
});
