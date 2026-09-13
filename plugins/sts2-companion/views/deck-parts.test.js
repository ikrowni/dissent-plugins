// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';
import { resolveCards, groupDeck, keywordCoverage, compareCoverage } from '../core/deck.js';
import { deckGrid, curvePanel, coveragePanel, relicRow, loadArt } from './deck-parts.js';
import { statusBlock, STATUS_TEXT } from './status.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const data = createData({ load });
const ctx = () => ({ data, art: { url: vi.fn(async () => 'blob:x') } });

describe('deckGrid over the REAL current run', () => {
  it('one tile per distinct card, with counts', async () => {
    const el = deckGrid(groupDeck(await resolveCards(data, snapshot('current-run-after').players[0].deck)));
    expect(el.querySelectorAll('.deck-tile')).toHaveLength(4);
    const strike = el.querySelector('[data-card="STRIKE_IRONCLAD"]');
    expect(strike.textContent).toContain('×5');
    expect(el.querySelector('h3').textContent).toMatch(/^Attack · \d+$/);
  });

  it('marks upgraded copies with a + and a badge', async () => {
    const el = deckGrid(groupDeck(await resolveCards(data, snapshot('run-1773796874').players[0].deck)));
    const up = el.querySelector('.deck-tile.upgraded');
    expect(up.querySelector('.label').textContent).toMatch(/\+$/);
    expect(up.querySelector('.badge')).not.toBeNull();
  });

  // 🔴 A card the data lacks shows its raw id and says why — never a blank tile.
  it('🔴 an unknown card is a labelled tile with no art request', async () => {
    const el = deckGrid(groupDeck(await resolveCards(data, [{ id: 'CARD.GRAPPLE', upgrades: 0 }])));
    const tile = el.querySelector('.deck-tile');
    expect(tile.classList.contains('is-unknown')).toBe(true);
    expect(tile.querySelector('.label').textContent).toBe('GRAPPLE');
    expect(tile.textContent).toContain('Not in this data build');
    expect(tile.querySelector('[data-art]')).toBeNull();
  });
});

describe('panels', () => {
  it('the curve panel draws six buckets and names what it did not count', async () => {
    const entries = await resolveCards(data, [{ id: 'CARD.BASH' }, { id: 'CARD.GRAPPLE' }]);
    const el = curvePanel(entries);
    expect(el.querySelectorAll('svg rect')).toHaveLength(6);
    expect(el.textContent).toMatch(/1 card not in this data build/);
  });

  it('the coverage panel shows one column, or two when comparing', async () => {
    const entries = await resolveCards(data, snapshot('current-run-after').players[0].deck);
    expect(coveragePanel(keywordCoverage(entries)).querySelectorAll('thead th')).toHaveLength(2);
    const rows = compareCoverage(keywordCoverage(entries), keywordCoverage(entries));
    expect(coveragePanel(rows, { a: 'Archetype', b: 'Current run' }).querySelectorAll('thead th')).toHaveLength(3);
  });

  it('relic row names every relic, unknown ids included', async () => {
    const el = await relicRow(ctx(), [...snapshot('current-run-after').players[0].relics, 'RELIC.NOT_REAL']);
    expect(el.textContent).toContain('Burning Blood');
    expect(el.querySelector('.is-unknown').textContent).toContain('NOT_REAL');
  });
});

describe('loadArt', () => {
  it('replaces each placeholder with an image once its URL arrives', async () => {
    const c = ctx();
    const root = document.createElement('div');
    root.append(deckGrid(groupDeck(await resolveCards(data, [{ id: 'CARD.BASH' }]))));
    loadArt(root, c);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.art.url).toHaveBeenCalledWith('card:BASH');
    expect(root.querySelector('img').getAttribute('src')).toBe('blob:x');
  });
});

describe('statusBlock', () => {
  it('says each status in words, and an unexpected one by name', () => {
    for (const s of Object.keys(STATUS_TEXT)) expect(statusBlock({ status: s }).textContent).toBe(STATUS_TEXT[s]);
    expect(statusBlock({ status: 'weird' }).textContent).toContain('weird');
    expect(statusBlock(undefined).dataset.status).toBe('error');
  });
});
