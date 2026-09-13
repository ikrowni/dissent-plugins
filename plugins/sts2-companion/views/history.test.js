// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const saves = vi.fn();
vi.mock('../core/host.js', () => ({ saves, store: { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn() } }));
const { mountHistory, PAGE } = await import('./history.js');
const { renderRunDetail } = await import('./run-detail.js');
const { renderCardStats } = await import('./card-stats.js');
const { STATUS_TEXT } = await import('./status.js');

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const ctx = () => ({ data: createData({ load }), art: { url: vi.fn(async () => 'blob:x'), releaseAll: vi.fn() } });

beforeEach(() => saves.mockReset());

describe('the run list', () => {
  it('lists the REAL runs page with outcome, characters and floors', async () => {
    saves.mockResolvedValue(snapshot('runs'));
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    expect(saves).toHaveBeenCalledWith('runs', { limit: PAGE });
    const row = root.querySelector('[data-run="1773796874"]');
    expect(row.textContent).toContain('Defeat');
    expect(row.textContent).toContain('Ironclad + Ironclad');
    expect(row.textContent).toContain('39 floors');
    expect(row.textContent).toContain('Soul Nexus');
    expect(root.querySelector('[data-act="more"]')).toBeNull(); // 1 run < a page
  });

  it('pages with before = the last id, and stops on a page with nothing readable', async () => {
    const page = { status: 'ok', runs: Array.from({ length: PAGE }, (_, i) => ({ ...snapshot('runs').runs[0], id: String(9000 - i) })), skipped: 0 };
    saves.mockResolvedValueOnce(page).mockResolvedValueOnce({ status: 'ok', runs: [], skipped: PAGE });
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    root.querySelector('[data-act="more"]').click();
    await flush();
    expect(saves).toHaveBeenLastCalledWith('runs', { limit: PAGE, before: String(9000 - PAGE + 1) });
    expect(root.querySelector('[data-act="more"]')).toBeNull();
    expect(root.textContent).toMatch(/could not be read/);
  });

  // Contract draft §3.11: a host that answers next_before lets paging continue past a page of
  // unreadable runs; without it (older desktop apps) an empty page still ends paging.
  it('follows next_before past a page with nothing readable', async () => {
    const run = snapshot('runs').runs[0];
    saves
      .mockResolvedValueOnce({ status: 'ok', runs: [{ ...run, id: '9000' }], skipped: PAGE - 1, next_before: '8981' })
      .mockResolvedValueOnce({ status: 'ok', runs: [], skipped: PAGE, next_before: '8961' })
      .mockResolvedValueOnce({ status: 'ok', runs: [{ ...run, id: '100' }], skipped: 0, next_before: null });
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    root.querySelector('[data-act="more"]').click();
    await flush();
    expect(saves).toHaveBeenLastCalledWith('runs', { limit: PAGE, before: '8981' });
    root.querySelector('[data-act="more"]').click();
    await flush();
    expect(saves).toHaveBeenLastCalledWith('runs', { limit: PAGE, before: '8961' });
    expect(root.querySelector('[data-run="100"]')).not.toBeNull();
    expect(root.querySelector('[data-act="more"]')).toBeNull();
  });

  it('a first page with nothing readable still offers older runs when the host has a cursor', async () => {
    saves.mockResolvedValueOnce({ status: 'ok', runs: [], skipped: PAGE, next_before: '5000' })
      .mockResolvedValueOnce({ status: 'ok', runs: [{ ...snapshot('runs').runs[0], id: '42' }], skipped: 0, next_before: null });
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    expect(root.textContent).toMatch(/could not be read/);
    root.querySelector('[data-act="more"]').click();
    await flush();
    expect(saves).toHaveBeenLastCalledWith('runs', { limit: PAGE, before: '5000' });
    expect(root.querySelector('[data-run="42"]')).not.toBeNull();
  });

  it('on web, says it needs the desktop app', async () => {
    saves.mockResolvedValue({ status: 'desktop_only' });
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    expect(root.querySelector('.status p').textContent).toBe(STATUS_TEXT.desktop_only);
  });

  it('opens a run and comes back', async () => {
    saves.mockImplementation(async (action) => (action === 'runs' ? snapshot('runs') : snapshot('run-1773796874')));
    const root = document.createElement('div');
    await mountHistory(root, ctx());
    await flush();
    root.querySelector('[data-run="1773796874"]').click();
    await flush();
    expect(saves).toHaveBeenLastCalledWith('run', { id: '1773796874' });
    expect(root.querySelectorAll('.timeline > li')).toHaveLength(39);
    root.querySelector('[data-act="back"]').click();
    await flush();
    expect(root.querySelector('[data-run="1773796874"]')).not.toBeNull();
  });
});

describe('a REAL finished run', () => {
  it('timeline, HP chart, picks against skips, and the final deck', async () => {
    const el = await renderRunDetail(snapshot('run-1773796874'), ctx(), { player: 1 });
    expect(el.querySelector('h2').textContent).toContain('Defeat');
    expect(el.querySelector('svg.line path.value')).not.toBeNull();
    const floor1 = el.querySelector('.timeline > li');
    expect(floor1.textContent).toContain('Floor 1');
    expect(floor1.querySelector('.picked').textContent).toBe('Setup Strike');
    expect([...floor1.querySelectorAll('.skipped')].map((s) => s.textContent)).toEqual(['Tremble', 'Blood Wall']);
    expect(el.querySelectorAll('.deck-tile').length).toBeGreaterThan(0);
  });

  // A shop's cards are for sale, not a reward: floor 5 of the real run is a shop where nothing was bought.
  it('a shop says what was bought, never "card reward"', async () => {
    const el = await renderRunDetail(snapshot('run-1773796874'), ctx(), { player: 1 });
    const shop = el.querySelector('.timeline > li.type-shop');
    expect(shop.textContent).not.toContain('Card reward');
    expect(shop.textContent).toContain('Shop cards');
    expect(shop.textContent).toContain('none bought');
  });

  it('switches player; the removed card GRAPPLE is shown by id and marked', async () => {
    const onPlayer = vi.fn();
    const one = await renderRunDetail(snapshot('run-1773796874'), ctx(), { player: 1, onPlayer });
    const buttons = one.querySelectorAll('[data-player]');
    expect(buttons).toHaveLength(2);
    buttons[1].click();
    expect(onPlayer).toHaveBeenCalledWith(2);
    const two = await renderRunDetail(snapshot('run-1773796874'), ctx(), { player: 2 });
    const grapple = [...two.querySelectorAll('.is-unknown')].find((n) => n.textContent === 'GRAPPLE');
    expect(grapple).toBeDefined();
  });

  it('a run that is gone says so', async () => {
    const el = await renderRunDetail({ status: 'not_found' }, ctx(), {});
    expect(el.textContent).toBe(STATUS_TEXT.not_found);
  });
});

describe('card stats over the REAL profile projection', () => {
  it('a row per card, sortable by any column', async () => {
    const stats = snapshot('profile-stats');
    const el = await renderCardStats(stats, ctx());
    expect(el.querySelectorAll('tbody tr')).toHaveLength(stats.cards.length);
    const winHeader = el.querySelector('[data-sort="winRate"]');
    winHeader.click();
    const rates = () => [...el.querySelectorAll('tbody tr')].map((r) => r.dataset.winRate).filter((v) => v !== '');
    expect(rates().map(Number)).toEqual([...rates().map(Number)].sort((a, b) => b - a));
    expect(winHeader.closest('th').getAttribute('aria-sort')).toBe('descending');
    winHeader.click();
    expect(rates().map(Number)).toEqual([...rates().map(Number)].sort((a, b) => a - b));
  });

  it('shows per-character records', async () => {
    const el = await renderCardStats(snapshot('profile-stats'), ctx());
    expect(el.querySelector('.characters').textContent).toContain('Silent');
  });
});
