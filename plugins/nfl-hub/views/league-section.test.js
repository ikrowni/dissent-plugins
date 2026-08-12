// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, setTab, wrapBody } from './league-section.js';

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
   * ⚠️ THE RULE IS READ FROM THE OUTPUT, NOT FROM A LIST OF TAB NAMES, and that
   * distinction is the whole fix. This started as `new Set(['draft', 'mock'])` on
   * the reasoning that those two bring their own stage — true, but only once a
   * BOARD IS UP. Their setup screen and empty states are ordinary panels, so the
   * name list left exactly those two screens unlit: "Start mock draft" and "No
   * draft has been set up for this league yet".
   */
  it('leaves a view that already lit itself alone', () => {
    const own = '<div class="gr-stage">a board</div>';
    expect(wrapBody(own)).toBe(own);
    expect(parse(wrapBody(own)).querySelector('.lg-stage')).toBeNull();
  });

  it('lights a view that did not, whatever tab it is on', () => {
    const bare = '<section class="panel">Start mock draft</section>';
    const el = parse(wrapBody(bare));
    expect(el.querySelector('.stage.lg-stage')).not.toBeNull();
    expect(el.querySelector('.lg-stage-in.m-stagger')).not.toBeNull();
    expect(el.textContent).toContain('Start mock draft');
  });

  // ⚠️ THE CASE THE NAME LIST GOT WRONG. Both of these render an ordinary panel
  // until somebody starts something, and both were the only unlit screens left.
  it('lights the draft and mock SETUP screens, which carry no board', () => {
    for (const tab of ['draft', 'mock']) {
      setTab(tab);
      const el = parse(render());
      expect(`${tab}: ${!!el.querySelector('.stage.lg-stage')}`).toBe(`${tab}: true`);
      // ...and never both surfaces at once.
      expect(`${tab}: ${!!el.querySelector('.lg-stage .gr-stage')}`).toBe(`${tab}: false`);
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
