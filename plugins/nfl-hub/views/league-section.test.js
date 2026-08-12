// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, setTab } from './league-section.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

/**
 * The section shell only decides two things: which sub-view renders, and whether
 * that sub-view gets a stage. This covers the second — the first is covered by
 * each sub-view's own test.
 *
 * ⚠️ THERE WAS NO TEST FILE HERE AT ALL. The stage exclusion shipped and a
 * mutation that emptied `OWN_STAGE` — putting a stage on the draft board's own
 * stage — passed the entire suite.
 */
describe('the sub-tab stage', () => {
  const tabs = ['home', 'matchup', 'roster', 'moves'];

  it('lights the four sub-tabs draft night left flat', () => {
    for (const tab of tabs) {
      setTab(tab);
      const el = parse(render());
      expect(`${tab}: ${!!el.querySelector('.stage.lg-stage')}`).toBe(`${tab}: true`);
      expect(el.querySelector('.lg-stage-in.m-stagger')).not.toBeNull();
    }
  });

  /**
   * ⚠️ THE DRAFT AND THE MOCK BRING THEIR OWN. gridiron.css built them a stage for
   * draft night; wrapping either in a second one puts a stage on a stage — two
   * gradients, two vignettes, and a board that reads as a picture of a board.
   */
  it('leaves the draft and the mock alone, because they bring their own stage', () => {
    for (const tab of ['draft', 'mock']) {
      setTab(tab);
      const el = parse(render());
      expect(`${tab}: ${!!el.querySelector('.lg-stage')}`).toBe(`${tab}: false`);
    }
  });

  it('always renders the sub-nav, whichever tab is showing', () => {
    for (const tab of [...tabs, 'draft', 'mock']) {
      setTab(tab);
      const el = parse(render());
      expect(el.querySelectorAll('[data-act="lg-tab"]').length).toBeGreaterThan(4);
    }
  });

  it('marks exactly one tab selected', () => {
    setTab('moves');
    const on = [...parse(render()).querySelectorAll('[data-act="lg-tab"]')]
      .filter((b) => b.getAttribute('aria-selected') === 'true');
    expect(on).toHaveLength(1);
    expect(on[0].dataset.tab).toBe('moves');
  });
});
