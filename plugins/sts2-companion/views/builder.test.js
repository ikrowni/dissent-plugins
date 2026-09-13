// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const mem = new Map();
const store = {
  get: vi.fn(async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : null)),
  set: vi.fn(async (k, v) => { mem.set(k, structuredClone(v)); }),
  del: vi.fn(async (k) => { mem.delete(k); }),
};
const saves = vi.fn();
vi.mock('../core/host.js', () => ({ store, saves }));
const { mountBuilder } = await import('./builder.js');
const { STATUS_TEXT } = await import('./status.js');

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 10)); };
const ctx = (over = {}) => ({ data: createData({ load }), art: { url: vi.fn(async () => 'blob:x'), releaseAll: vi.fn() }, saveDelayMs: 0, ...over });

async function create(root, name = 'Strength') {
  root.querySelector('[aria-label="New archetype name"]').value = name;
  root.querySelector('[data-act="create"]').click();
  await flush();
}
async function add(root, q, id) {
  const search = root.querySelector('[aria-label="Add a card"]');
  search.value = q;
  search.dispatchEvent(new Event('input'));
  root.querySelector(`[data-add="${id}"]`).click();
  await flush();
}

beforeEach(() => { mem.clear(); saves.mockReset(); });

describe('the Builder', () => {
  it('creates a named archetype for the chosen character', async () => {
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    const index = mem.get('archetypes');
    expect(index).toEqual([expect.objectContaining({ name: 'Strength', character: 'ironclad' })]);
    expect(mem.has(`archetype:${index[0].id}`)).toBe(true);
    expect(root.querySelector('.arch-editor h2').textContent).toBe('Strength · 0 cards');
  });

  it('adds cards from the character pool, removes one, toggles an upgrade — each persisted', async () => {
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    await add(root, 'bash', 'BASH');
    await add(root, 'bash', 'BASH');
    const key = `archetype:${mem.get('archetypes')[0].id}`;
    expect(mem.get(key).cards).toEqual([{ id: 'BASH', upgrades: 0 }, { id: 'BASH', upgrades: 0 }]);
    expect(root.querySelector('[data-card="BASH"]').textContent).toContain('×2');

    root.querySelector('[data-card="BASH"] [data-act="upgrade"]').click();
    await flush();
    expect(mem.get(key).cards).toEqual([{ id: 'BASH', upgrades: 1 }, { id: 'BASH', upgrades: 0 }]);
    expect(root.querySelector('[data-card="BASH"][data-upgrades="1"] .label').textContent).toBe('Bash+');

    root.querySelector('[data-card="BASH"][data-upgrades="0"] [data-act="remove"]').click();
    await flush();
    expect(mem.get(key).cards).toEqual([{ id: 'BASH', upgrades: 1 }]);
  });

  // ⚠️ The node allows 60 personal-storage writes a minute. Quick edits collapse into one write.
  // The delay is long so nothing here races the timer; the timed save itself runs in every other
  // test (saveDelayMs: 0).
  it('quick edits are saved once, when the pause ends or on leaving', async () => {
    const root = document.createElement('div');
    const view = await mountBuilder(root, ctx({ saveDelayMs: 60_000 }));
    await create(root);
    const key = `archetype:${mem.get('archetypes')[0].id}`;
    store.set.mockClear();
    await add(root, 'bash', 'BASH');
    await add(root, 'bash', 'BASH');
    await add(root, 'inflame', 'INFLAME');
    expect(store.set).not.toHaveBeenCalled();
    expect(root.querySelector('.arch-editor h2').textContent).toBe('Strength · 3 cards');
    await view.destroy();
    expect(store.set.mock.calls.map((c) => c[0])).toEqual([key]);
    expect(mem.get(key).cards).toHaveLength(3);
  });

  it('offers only the character and colourless cards', async () => {
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    const search = root.querySelector('[aria-label="Add a card"]');
    search.value = 'strike';
    search.dispatchEvent(new Event('input'));
    const ids = [...root.querySelectorAll('[data-add]')].map((b) => b.dataset.add);
    expect(ids).toContain('STRIKE_IRONCLAD');
    expect(ids).not.toContain('STRIKE_SILENT');
  });

  it('a saved archetype is there after remounting', async () => {
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root, 'Kept');
    const again = document.createElement('div');
    await mountBuilder(again, ctx());
    expect(again.querySelector('[data-arch]').textContent).toBe('Kept');
  });

  it('deletes only after a confirming second click', async () => {
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    root.querySelector('[data-act="delete"]').click();
    await flush();
    expect(mem.get('archetypes')).toHaveLength(1);
    root.querySelector('[data-act="delete"]').click();
    await flush();
    expect(mem.get('archetypes')).toEqual([]);
  });

  it('compares with the REAL current run', async () => {
    saves.mockResolvedValue(snapshot('current-run-after'));
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    await add(root, 'inflame', 'INFLAME');
    root.querySelector('[data-act="compare"]').click();
    await flush();
    const head = [...root.querySelectorAll('.coverage thead th')].map((t) => t.textContent);
    expect(head).toEqual(['Keyword or power', 'Archetype', 'Current run']);
    const vuln = [...root.querySelectorAll('.coverage tbody tr')].find((r) => r.firstChild.textContent === 'Vulnerable');
    expect([...vuln.querySelectorAll('td')].map((t) => t.textContent)).toEqual(['0', '1']);
    expect(root.querySelectorAll('.curve')).toHaveLength(2);
  });

  it('compare on web says why, and keeps the builder usable', async () => {
    saves.mockResolvedValue({ status: 'desktop_only' });
    const root = document.createElement('div');
    await mountBuilder(root, ctx());
    await create(root);
    root.querySelector('[data-act="compare"]').click();
    await flush();
    expect(root.querySelector('.status p').textContent).toBe(STATUS_TEXT.desktop_only);
    expect(root.querySelector('[aria-label="Add a card"]')).not.toBeNull();
  });
});
