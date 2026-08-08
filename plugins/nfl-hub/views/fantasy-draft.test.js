import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDraftPicks, draftBoard } from '../core/sleeper-draft.js';
import { renderPanel } from './fantasy-draft.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const board = draftBoard(parseDraftPicks(fx('sleeper-draft-picks.json')));
const state = {
  board,
  rosterNames: { 6: 'Alpha', 2: 'Beta' },
  draft: { draftId: 'd1', status: 'complete', season: '2025', rounds: 3, type: 'linear' },
};

describe('renderPanel', () => {
  it('renders a cell for every pick', () => {
    const html = renderPanel(state);
    expect(html).toContain('Ashton Jeanty');
    expect(html).toContain('RB');
  });

  it('labels each column with the drafting team', () => {
    expect(renderPanel(state)).toContain('Alpha');
  });

  it('renders one row per round', () => {
    const html = renderPanel(state);
    expect((html.match(/class="dr-round"/g) ?? [])).toHaveLength(3);
  });

  it('renders an empty cell where a pick is missing', () => {
    const sparse = draftBoard(parseDraftPicks([
      { pick_no: 1, round: 1, draft_slot: 1, roster_id: 6, metadata: { first_name: 'A', last_name: 'B' } },
      { pick_no: 3, round: 1, draft_slot: 3, roster_id: 2, metadata: { first_name: 'C', last_name: 'D' } },
    ]));
    expect(renderPanel({ ...state, board: sparse })).toContain('dr-empty');
  });

  it('escapes a player name containing markup', () => {
    const evil = draftBoard(parseDraftPicks([
      { pick_no: 1, round: 1, draft_slot: 1, roster_id: 6, metadata: { first_name: '<img', last_name: 'x>' } },
    ]));
    const html = renderPanel({ ...state, board: evil });
    expect(html).not.toContain('<img x>');
    expect(html).toContain('&lt;img');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ board: { rounds: [], slots: [], slotRoster: {} } }))
      .toContain('No draft');
  });
});

describe('draft picker', () => {
  const drafts = [
    { draftId: 'a', name: 'Happy Hour', teams: 8, startTime: 2, isMock: false, status: 'complete' },
    { draftId: 'b', name: 'Happy Hour', teams: 8, startTime: 1, isMock: true, status: 'complete' },
  ];

  it('is hidden when there is only one draft', () => {
    const html = renderPanel({ board, drafts: [drafts[0]], draftId: 'a' });
    expect(html).not.toContain('dr-picker');
  });

  it('lists every draft once there is a choice', () => {
    const html = renderPanel({ board, drafts, draftId: 'a' });
    expect(html.match(/data-act="draft-pick"/g)).toHaveLength(2);
  });

  it('LABELS the mock, because the names collide', () => {
    // ⚠️ This account genuinely has two drafts both called "Happy Hour" — one real, one
    // mock. Without the label the picker shows two identical buttons.
    const html = renderPanel({ board, drafts, draftId: 'a' });
    expect(html).toContain('Mock');
  });

  it('marks which draft is open', () => {
    const html = renderPanel({ board, drafts, draftId: 'b' });
    expect(html.match(/dr-tab is-on/g)).toHaveLength(1);
  });

  it('keeps the picker visible when the chosen draft has no picks', () => {
    // ⚠️ Otherwise a pre-draft league hides the picker and the completed mocks in it —
    // which is exactly what "my mock draft is not showing" looked like.
    const html = renderPanel({ board: null, drafts, draftId: 'a' });
    expect(html).toContain('dr-picker');
    expect(html).toContain('Happy Hour');
  });

  it('names the empty draft rather than blaming the league', () => {
    const html = renderPanel({ board: null, drafts, draftId: 'a' });
    expect(html).toContain('Happy Hour');
    expect(html).not.toContain('No draft has been held in this league');
  });
});
