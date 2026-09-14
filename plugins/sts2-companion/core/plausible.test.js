import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { buildContribution } from './contribution.js';
import { checkContribution } from './plausible.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const run = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));
const data = createData({ load });
const good = () => structuredClone(buildContribution(run));

describe('checkContribution', () => {
  it('accepts the REAL run, whose one unknown card (CARD.GRAPPLE) is within tolerance', async () => {
    expect(await checkContribution(good(), data)).toEqual({ ok: true });
  });

  const cases = [
    ['schema', (c) => { c.schema = 2; }],
    ['build', (c) => { c.build = 'yesterday'; }],
    ['ascension', (c) => { c.ascension = 99; }],
    ['killed_by', (c) => { c.win = true; }],
    ['floors', (c) => { c.floors = 500; }],
    ['run_minutes', (c) => { c.runMinutes = -10; }],
    ['players', (c) => { c.players = []; }],
    ['character', (c) => { c.players[0].character = 'RELIC.BURNING_BLOOD'; }],
    ['deck', (c) => { c.players[0].deck[0].upgrades = 50; }],
    ['relics', (c) => { c.players[0].relics.push('not an id'); }],
    ['choices', (c) => { c.players[0].choices[0].picked = 'yes'; }],
    ['damage', (c) => { c.players[0].damageByAct = [-1]; }],
    ['floor_rows', (c) => { c.players[0].floors[0].hp = 5000; }],
    ['fields', (c) => { c.runId = '1773796874'; }],
    ['fields', (c) => { c.players[0].steamId = '7656119'; }],
    ['fields', (c) => { c.players[0].floors[0].gold = 111; }],
    ['fields', (c) => { c.players[0].deck[0].note = 'x'; }],
    ['unknown_ids', (c) => { c.players[0].deck = c.players[0].deck.map((d, i) => ({ ...d, id: `CARD.INVENTED_${i}` })); }],
  ];
  for (const [reason, mutate] of cases) {
    it(`refuses: ${reason}`, async () => {
      const c = good();
      mutate(c);
      expect(await checkContribution(c, data)).toEqual({ ok: false, reason });
    });
  }

  it('refuses something that is not an object', async () => {
    expect(await checkContribution(null, data)).toEqual({ ok: false, reason: 'not_an_object' });
  });
});
