import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { floorRows, hpSeries, actMarks, floorChanges, outcome, formatDuration, cardStatRows, sortRows } from './runs.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const run = snapshot('run-1773796874');

describe('floors of the REAL finished co-op run', () => {
  it('numbers floors across acts', () => {
    const rows = floorRows(run, 1);
    expect(rows).toHaveLength(39);
    expect(rows[0]).toMatchObject({ floor: 1, act: 1 });
    expect(rows[16]).toMatchObject({ floor: 17, act: 2 });
    expect(rows[31]).toMatchObject({ floor: 32, act: 3 });
    expect(rows.at(-1).type).toBe('elite');
    expect(rows[0].rooms[0]).toMatchObject({ id: 'ENCOUNTER.NIBBITS_WEAK', turns: 5 });
  });

  it('takes the chosen player’s stat line', () => {
    expect(floorRows(run, 1)[0].stats).toMatchObject({ hp: 69, max_hp: 80 });
    expect(floorRows(run, 2)[0].stats).toMatchObject({ hp: 70, max_hp: 80 });
  });

  it('HP series ends at 0 and act marks sit on the first floor of acts 2 and 3', () => {
    const rows = floorRows(run, 1);
    const hp = hpSeries(rows);
    expect(hp).toHaveLength(39);
    expect(hp[0]).toEqual({ x: 1, y: 69, max: 80 });
    expect(hp.at(-1).y).toBe(0);
    expect(actMarks(rows)).toEqual([{ x: 17, label: 'Act 2' }, { x: 32, label: 'Act 3' }]);
  });

  it('floor changes: picks against skips', () => {
    const c = floorChanges(floorRows(run, 1)[0].stats);
    expect(c.cardPicked).toEqual(['CARD.SETUP_STRIKE']);
    expect(c.cardSkipped).toEqual(['CARD.TREMBLE', 'CARD.BLOOD_WALL']);
    expect(c.damage).toBe(17);
  });

  // CARD.GRAPPLE was offered to player 2 in act 2 and is absent from the 1.3.0 data.
  it('keeps a card the data lacks in the skips', () => {
    const rows = floorRows(run, 2).filter((r) => floorChanges(r.stats).cardSkipped.includes('CARD.GRAPPLE'));
    expect(rows).toHaveLength(1);
    expect(rows[0].act).toBe(2);
  });

  it('cards gained other than a reward pick are listed apart', () => {
    const neow = floorChanges(snapshot('current-run-after').floors[0].players[0]);
    expect(neow.cardPicked).toEqual([]);
    expect(neow.gained).toEqual(['CARD.FEED']);
  });
});

describe('summary formatting', () => {
  it('outcome and duration', () => {
    expect(outcome(run.summary)).toBe('Defeat');
    expect(outcome({ win: true })).toBe('Victory');
    expect(outcome({ win: false, abandoned: true })).toBe('Abandoned');
    expect(formatDuration(run.summary.run_time)).toBe('2h 17m');
    expect(formatDuration(59)).toBe('<1m');
    expect(formatDuration(null)).toBe('');
  });
});

describe('card stats from the REAL profile projection', () => {
  const stats = snapshot('profile-stats');
  const data = createData({ load });

  it('joins names and computes rates, null when nothing to divide', async () => {
    const rows = await cardStatRows(data, stats);
    expect(rows).toHaveLength(stats.cards.length);
    const strike = rows.find((r) => r.id === 'CARD.STRIKE_SILENT');
    expect(strike).toMatchObject({ name: 'Strike', pickRate: null });
    expect(strike.winRate).toBeCloseTo(strike.won / (strike.won + strike.lost));
  });

  it('sorts either way with nulls always last', async () => {
    const rows = await cardStatRows(data, stats);
    for (const dir of ['asc', 'desc']) {
      const sorted = sortRows(rows, 'pickRate', dir);
      const firstNull = sorted.findIndex((r) => r.pickRate == null);
      expect(sorted.slice(firstNull).every((r) => r.pickRate == null)).toBe(true);
      const vals = sorted.slice(0, firstNull).map((r) => r.pickRate);
      expect(vals).toEqual([...vals].sort((a, b) => (dir === 'asc' ? a - b : b - a)));
    }
    expect(sortRows(rows, 'name', 'asc')[0].name.localeCompare(sortRows(rows, 'name', 'asc')[1].name)).toBeLessThanOrEqual(0);
  });
});
