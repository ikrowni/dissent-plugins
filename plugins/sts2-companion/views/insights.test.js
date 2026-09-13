// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const saves = vi.fn();
let localValue = null;
const local = { get: vi.fn(async () => localValue), set: vi.fn(async (_k, v) => { localValue = v; }) };
vi.mock('../core/host.js', () => ({ saves, local, store: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
const { mountInsights } = await import('./insights.js');
const { STATUS_TEXT } = await import('./status.js');

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const ctx = () => ({ data: createData({ load }), onSavesChanged: vi.fn(() => () => {}) });

beforeEach(() => {
  localValue = null;
  saves.mockReset();
  saves.mockImplementation(async (action, params) => {
    if (action === 'runs') return snapshot('runs');
    if (action === 'run') return params.id === '1773796874' ? snapshot('run-1773796874') : { status: 'not_found' };
    return { status: 'error' };
  });
});

describe('Insights over the REAL co-op run', () => {
  it('summarises runs, and names the encounter that ended it', async () => {
    const root = document.createElement('div');
    await mountInsights(root, ctx());
    await flush();
    expect(root.querySelector('[data-part="summary"]').textContent).toContain('1 run · 0 wins · 0 solo · 1 co-op');
    const row = root.querySelector('[data-encounter="ENCOUNTER.SOUL_NEXUS_ELITE"]');
    expect(row.textContent).toContain('Soul Nexus');
    // 1 of 1: below the minimum, so no percentage — the count and n instead.
    expect(row.textContent).toContain('— (n=1)');
  });

  it('explains why builds and cards are empty when every run was co-op', async () => {
    const root = document.createElement('div');
    await mountInsights(root, ctx());
    await flush();
    expect(root.querySelector('[data-part="builds"]').textContent).toMatch(/solo runs/i);
    expect(root.querySelector('[data-part="cards"]').textContent).toMatch(/solo runs/i);
  });

  it('filters by character', async () => {
    const root = document.createElement('div');
    await mountInsights(root, ctx());
    await flush();
    root.querySelector('[data-character="CHARACTER.SILENT"]').click();
    await flush();
    expect(root.querySelector('[data-part="summary"]').textContent).toContain('0 runs');
    expect(root.querySelector('[data-character="CHARACTER.SILENT"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('says it is reading while digests are built, then shows the figures', async () => {
    let release;
    saves.mockImplementation(async (action) => {
      if (action === 'runs') return snapshot('runs');
      await new Promise((r) => { release = r; });
      return snapshot('run-1773796874');
    });
    const root = document.createElement('div');
    const mounting = mountInsights(root, ctx());
    await flush();
    expect(root.textContent).toMatch(/Reading your runs/);
    release();
    await mounting;
    await flush();
    expect(root.querySelector('[data-part="summary"]')).not.toBeNull();
  });

  it('on web, says the runs are read by the desktop app', async () => {
    saves.mockImplementation(async () => ({ status: 'desktop_only' }));
    const root = document.createElement('div');
    await mountInsights(root, ctx());
    await flush();
    expect(root.textContent).toContain(STATUS_TEXT.desktop_only);
  });

  it('re-reads when the saves change, and stops listening on destroy', async () => {
    const off = vi.fn();
    let onChange;
    const c = { ...ctx(), onSavesChanged: vi.fn((fn) => { onChange = fn; return off; }) };
    const root = document.createElement('div');
    const mounted = await mountInsights(root, c);
    await flush();
    saves.mockClear();
    onChange();
    await flush();
    expect(saves).toHaveBeenCalledWith('runs', expect.anything());
    mounted.destroy();
    expect(off).toHaveBeenCalled();
  });
});
