import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData, saveIdToDataId, humanizeId } from './data.js';

const DATA = new URL('../data/', import.meta.url);
const load = async (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DATA)));
const FIXTURES = '/home/ubuntu/projects/dissent-client/src-tauri/tests/fixtures/sts2/';

describe('saveIdToDataId', () => {
  it('strips the save prefix', () => {
    expect(saveIdToDataId('CARD.BASH')).toEqual({ kind: 'card', id: 'BASH' });
    expect(saveIdToDataId('RELIC.AKABEKO')).toEqual({ kind: 'relic', id: 'AKABEKO' });
    expect(saveIdToDataId('ENCOUNTER.CORPSE_SLUGS_WEAK')).toEqual({ kind: 'encounter', id: 'CORPSE_SLUGS_WEAK' });
    expect(saveIdToDataId('BASH')).toEqual({ kind: null, id: 'BASH' });
  });
});

describe('the data module over the REAL bundled data', () => {
  const data = createData({ load });

  it('finds a card', async () => {
    const bash = await data.get('card', 'BASH');
    expect(bash.name).toBe('Bash');
  });

  it('answers an explicit unknown, never undefined, for an id it lacks', async () => {
    const x = await data.get('card', 'NOT_A_CARD');
    expect(x).toMatchObject({ unknown: true, id: 'NOT_A_CARD', name: 'NOT_A_CARD' });
  });

  it('resolves a power by its display name, as game text refers to it', async () => {
    const v = await data.powerByName('Vulnerable');
    expect(v?.unknown).not.toBe(true);
  });

  // 🔴 Every card and relic the owner's real saves mention must be in the data. An unmapped
  // id here is a deck that renders blank tiles in plan 2.
  //
  // ⚠️ EXCEPT ids the game has since removed. The fixtures are build v0.99.1 (March 2026); the
  // data is 1.3.0. Each exception names its evidence, and is itself asserted to be absent and to
  // render as an explicit unknown — so the list can never hide a mapping bug.
  const REMOVED_SINCE_FIXTURE_BUILD = {
    // Offered (and skipped) as a card reward, finished_coop_loss.run, act 2 floor 5, player 2.
    // No card with this id or name exists in the Spire Codex 1.3.0 export.
    'CARD.GRAPPLE': 'absent from 1.3.0',
  };

  it('🔴 maps every card, relic, potion, encounter, event and monster id in the scrubbed save fixtures', async () => {
    const text = ['current_run_after_first_combat.save', 'finished_coop_loss.run']
      .map((f) => readFileSync(FIXTURES + f, 'utf8')).join('\n');
    const ids = [...new Set(text.match(/"(CARD|RELIC|POTION|ENCOUNTER|EVENT|MONSTER)\.[A-Z0-9_]+"/g).map((s) => s.slice(1, -1)))];
    const unmapped = [];
    for (const raw of ids) {
      const { kind, id } = saveIdToDataId(raw);
      if ((await data.get(kind, id)).unknown) unmapped.push(raw);
    }
    expect(unmapped.filter((id) => !REMOVED_SINCE_FIXTURE_BUILD[id])).toEqual([]);
  });

  it('a card removed since the fixtures were captured renders as an explicit unknown', async () => {
    for (const raw of Object.keys(REMOVED_SINCE_FIXTURE_BUILD)) {
      const { kind, id } = saveIdToDataId(raw);
      expect(await data.get(kind, id), raw).toMatchObject({ unknown: true, id });
    }
  });
});

describe('humanizeId', () => {
  it('turns an id the data has no records for into words', () => {
    expect(humanizeId('ACT.UNDERDOCKS')).toBe('Underdocks');
    expect(humanizeId('CHARACTER.IRONCLAD')).toBe('Ironclad');
    expect(humanizeId('HEAL')).toBe('Heal');
    expect(humanizeId('THE_FUTURE_OF_POTIONS')).toBe('The Future Of Potions');
    expect(humanizeId(null)).toBe('');
  });
});

describe('data.label', () => {
  const data = createData({ load });
  it('names a save id from the data', async () => {
    expect(await data.label('CARD.BASH')).toEqual({ name: 'Bash', unknown: false });
    expect((await data.label('ENCOUNTER.NIBBITS_WEAK')).unknown).toBe(false);
  });
  // A card removed since this data build still shows, by its raw id, marked unknown.
  it('keeps the raw id, marked, for an id the data lacks', async () => {
    expect(await data.label('CARD.GRAPPLE')).toEqual({ name: 'GRAPPLE', unknown: true });
  });
  it('humanizes a kind the data has no records of', async () => {
    expect(await data.label('ACT.UNDERDOCKS')).toEqual({ name: 'Underdocks', unknown: false });
  });
});
