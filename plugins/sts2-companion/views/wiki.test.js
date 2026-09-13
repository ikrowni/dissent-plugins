// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

vi.mock('../core/host.js', () => ({ store: { get: vi.fn(async () => null), set: vi.fn() }, saves: vi.fn(async () => ({ status: 'desktop_only' })) }));
const { mountWiki } = await import('./wiki.js');

// process.cwd(), not import.meta.url: under jsdom the module URL is not a file: URL.
const load = async (n) => JSON.parse(readFileSync(`${process.cwd()}/plugins/sts2-companion/data/${n}.json`));
const ctx = () => ({ data: createData({ load }), art: { url: vi.fn(async () => 'blob:x'), releaseAll: vi.fn() }, placement: 'page' });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the wiki grid', () => {
  it('shows every card by default, as images with names', async () => {
    const root = document.createElement('div');
    await mountWiki(root, ctx());
    await flush();
    const cards = await load('cards');
    expect(root.querySelectorAll('.grid .tile')).toHaveLength(cards.length);
  });

  it('narrows as you type', async () => {
    const root = document.createElement('div');
    await mountWiki(root, ctx());
    const input = root.querySelector('input[type="search"]');
    input.value = 'bash';
    input.dispatchEvent(new Event('input'));
    await flush();
    const names = [...root.querySelectorAll('.grid .tile .label')].map((n) => n.textContent);
    expect(names[0]).toBe('Bash');
  });

  it('switches category tabs', async () => {
    const root = document.createElement('div');
    await mountWiki(root, ctx());
    root.querySelector('[data-tab="monsters"]').click();
    await flush();
    const monsters = await load('monsters');
    expect(root.querySelectorAll('.grid .tile')).toHaveLength(monsters.length);
  });

  it('says so when nothing matches', async () => {
    const root = document.createElement('div');
    await mountWiki(root, ctx());
    const input = root.querySelector('input[type="search"]');
    input.value = 'zzzz-no-such-thing';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(root.querySelector('.empty').textContent).toMatch(/nothing matches/i);
  });

  it('releases images when the view is replaced', async () => {
    const root = document.createElement('div');
    const c = ctx();
    const view = await mountWiki(root, c);
    view.destroy();
    expect(c.art.releaseAll).toHaveBeenCalled();
  });
});
describe('in the overlay', () => {
  it('focuses and selects the search box when asked', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = await mountWiki(root, { ...ctx(), placement: 'overlay' });
    const input = root.querySelector('input[type="search"]');
    input.value = 'bash';
    view.focusSearch();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
    root.remove();
  });
});
