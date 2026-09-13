// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const saves = vi.fn();
vi.mock('../core/host.js', () => ({ saves, store: { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn() } }));
const { mountDeck } = await import('./deck.js');
const { STATUS_TEXT } = await import('./status.js');

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeCtx() {
  const listeners = new Set();
  return {
    data: createData({ load }),
    art: { url: vi.fn(async () => 'blob:x'), releaseAll: vi.fn() },
    onSavesChanged: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    fire: () => [...listeners].forEach((fn) => fn({ game: 'slay-the-spire-2' })),
    listeners,
  };
}

beforeEach(() => saves.mockReset());

describe('the Deck section over the REAL current-run projection', () => {
  it('shows the run: character, act, HP, deck, curve and coverage', async () => {
    saves.mockResolvedValue(snapshot('current-run-after'));
    const root = document.createElement('div');
    await mountDeck(root, makeCtx());
    await flush();
    expect(saves).toHaveBeenCalledWith('currentRun');
    expect(root.querySelector('.run-head h2').textContent).toBe('Ironclad · Act 1 · Underdocks');
    expect(root.querySelector('.run-head').textContent).toContain('75/83 HP');
    expect(root.querySelectorAll('.deck-tile')).toHaveLength(4);
    expect(root.querySelector('.curve svg')).not.toBeNull();
    expect(root.querySelector('.coverage').textContent).toContain('Vulnerable');
    expect(root.querySelector('.relics').textContent).toContain('Burning Blood');
  });

  // Save data is as of the last room change (platform spec §5.4); never imply it is live.
  it('says the data is as of entering this room', async () => {
    saves.mockResolvedValue(snapshot('current-run-after'));
    const root = document.createElement('div');
    await mountDeck(root, makeCtx());
    await flush();
    expect(root.querySelector('.asof').textContent).toMatch(/^As of entering this room/);
  });

  it('re-pulls when the game saves', async () => {
    saves.mockResolvedValueOnce(snapshot('current-run-entering')).mockResolvedValueOnce(snapshot('current-run-after'));
    const root = document.createElement('div');
    const ctx = makeCtx();
    await mountDeck(root, ctx);
    await flush();
    expect(root.querySelector('.run-head').textContent).toContain('80/80 HP');
    ctx.fire();
    await flush(); await flush();
    expect(root.querySelector('.run-head').textContent).toContain('75/83 HP');
  });

  it('stops listening when destroyed', async () => {
    saves.mockResolvedValue(snapshot('current-run-after'));
    const ctx = makeCtx();
    const view = await mountDeck(document.createElement('div'), ctx);
    view.destroy();
    expect(ctx.listeners.size).toBe(0);
    expect(ctx.art.releaseAll).toHaveBeenCalled();
  });
});

describe('every non-ok status is said plainly', () => {
  for (const status of ['desktop_only', 'no_current_run', 'no_game_data', 'unsupported_version', 'unsupported_coop', 'unreadable']) {
    it(status, async () => {
      saves.mockResolvedValue({ status });
      const root = document.createElement('div');
      await mountDeck(root, makeCtx());
      await flush();
      expect(root.querySelector('.status p').textContent).toBe(STATUS_TEXT[status]);
    });
  }

  it('desktop_only offers the Builder, which works on web', async () => {
    saves.mockResolvedValue({ status: 'desktop_only' });
    const root = document.createElement('div');
    await mountDeck(root, makeCtx());
    await flush();
    root.querySelector('[data-act="open-builder"]').click();
    await flush();
    expect(root.querySelector('[data-tab="builder"]').getAttribute('aria-selected')).toBe('true');
  });
});
