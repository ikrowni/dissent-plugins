import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLeagueInput, planImport, adjustments, notImported, importUrls,
} from './sleeper-import.js';
import { validateSettings, FORMAT } from './league/settings.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));

// ⚠️ THE REAL PAYLOAD, recorded from the live account 2026-08-12 — two leagues,
// one 4-team and one 8-team, both redraft. Every assertion below that matters is
// against these, not against a shape invented to pass.
const leagues = fx('sleeper-user-leagues.json');
const small = leagues.find((l) => l.settings.num_teams === 4);
const big = leagues.find((l) => l.settings.num_teams === 8);

describe('parseLeagueInput', () => {
  // ⚠️ PEOPLE PASTE URLs. A league id is an 18-digit number nobody memorises and
  // the only place anyone sees one is the address bar.
  it('pulls the id out of a pasted Sleeper URL', () => {
    expect(parseLeagueInput('https://sleeper.com/leagues/1347854506179719168/team'))
      .toBe('1347854506179719168');
    expect(parseLeagueInput('https://sleeper.app/draft/nfl/1392730730374631424'))
      .toBe('1392730730374631424');
  });

  it('takes a bare id', () => {
    expect(parseLeagueInput('  1347854506179719168 ')).toBe('1347854506179719168');
  });

  // ⚠️ A USERNAME MUST NOT LOOK LIKE A LEAGUE. Returning null here is what sends
  // the lookup down the username path instead.
  it('refuses anything that is not an id, so a username falls through', () => {
    expect(parseLeagueInput('ikrowni')).toBeNull();
    expect(parseLeagueInput('12345')).toBeNull();      // too short to be a league id
    expect(parseLeagueInput('')).toBeNull();
    expect(parseLeagueInput(null)).toBeNull();
  });
});

describe('planImport against the real leagues', () => {
  /**
   * ⚠️ THE TEST THIS WHOLE FEATURE TURNS ON. `fromSleeperSettings` had NO CALLER
   * until 2026-08-12, so its output had never once been run through
   * `validateSettings` — which `league:create` does, and refuses on. When it
   * finally was, BOTH live leagues came back invalid:
   *
   *   'maxKeepers has no meaning in a redraft league'   ← both
   *   'vetoVotesNeeded (6) exceeds numTeams (4)'        ← the 4-team league
   *
   * A mapper with no caller has never been checked against the thing it maps into.
   */
  it('produces settings the server will actually accept, for every real league', () => {
    expect(leagues.length).toBeGreaterThan(1);
    for (const l of leagues) {
      const plan = planImport(l);
      expect(`${l.name}: ${plan.errors.join('; ')}`).toBe(`${l.name}: `);
      expect(plan.ok).toBe(true);
      // ...and validated independently of planImport's own call, so a planImport
      // that forgot to check would not hide it.
      expect(validateSettings(plan.settings).valid).toBe(true);
    }
  });

  it('carries the rules that make a league itself', () => {
    const plan = planImport(big);
    expect(plan.settings.name).toBe('Happy Hour');
    expect(plan.settings.numTeams).toBe(8);
    expect(plan.settings.rosterPositions).toEqual(big.roster_positions);
    expect(plan.settings.scoring).toEqual(big.scoring_settings);
    expect(plan.settings.playoffWeekStart).toBe(big.settings.playoff_week_start);
  });

  // ⚠️ Sleeper ships `max_keepers: 1` on redraft leagues, where it means nothing.
  // Copying that residue through is what made every import invalid.
  it('drops the keeper count Sleeper leaves on a redraft league', () => {
    expect(big.settings.max_keepers).toBeGreaterThan(0);
    const plan = planImport(big);
    expect(plan.settings.format).toBe(FORMAT.REDRAFT);
    expect(plan.settings.maxKeepers).toBe(0);
    expect(plan.adjustments.join(' ')).toMatch(/keepers turned off/i);
  });

  // ⚠️ THE OVERFLOW WAS OURS. Sleeper omits `veto_votes_needed` on both leagues,
  // so the default of 6 leaked into a 4-team league — a threshold nobody can ever
  // reach, which silently turns trade vetoes off.
  it('clamps a veto threshold the league can never reach', () => {
    expect(small.settings.veto_votes_needed).toBeUndefined();
    const plan = planImport(small);
    expect(plan.settings.vetoVotesNeeded).toBeLessThanOrEqual(plan.settings.numTeams);
    expect(plan.adjustments.join(' ')).toMatch(/veto votes/i);
  });

  it('keeps a keeper league’s keepers', () => {
    const keeper = { ...big, settings: { ...big.settings, type: 1, max_keepers: 3 } };
    const plan = planImport(keeper);
    expect(plan.settings.format).toBe(FORMAT.KEEPER);
    expect(plan.settings.maxKeepers).toBe(3);
    expect(plan.adjustments.join(' ')).not.toMatch(/keepers turned off/i);
  });

  it('says nothing was adjusted when nothing was', () => {
    const clean = {
      ...big,
      settings: { ...big.settings, max_keepers: 0, veto_votes_needed: 4, num_teams: 8 },
    };
    expect(adjustments(clean, planImport(clean).settings)).toEqual([]);
  });

  /**
   * ⚠️ THE POINT OF VALIDATING HERE AT ALL. `league:create` validates too and
   * refuses, so a league we cannot represent must become a MESSAGE, not a button
   * that fails when pressed. An odd team count is the realistic case: Sleeper
   * runs them happily, our engine needs a median matchup or somebody sits out
   * every week — and that is a rule, not a bug.
   */
  it('refuses a real league it genuinely cannot represent, and says why', () => {
    const odd = {
      ...big,
      settings: { ...big.settings, num_teams: 5, league_average_match: 0 },
    };
    const plan = planImport(odd);
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/odd number of teams/i);
    // ...and it still explains itself rather than going blank.
    expect(plan.notImported.length).toBeGreaterThan(0);
    expect(plan.settings).toBeTruthy();
  });

  it('refuses a playoff bigger than the league', () => {
    const plan = planImport({ ...big, settings: { ...big.settings, playoff_teams: 12 } });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/playoffTeams/i);
  });

  it('refuses a payload that is not a league rather than throwing', () => {
    for (const junk of [null, undefined, 'nope', 42]) {
      const plan = planImport(junk);
      expect(plan.ok).toBe(false);
      expect(plan.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('what an import cannot bring', () => {
  /**
   * ⚠️ NOT A DISCLAIMER — A SPECIFICATION, and the UI is required to show it. A
   * commissioner who imports a mid-season league and assumes their rosters came
   * with it has been misled by us. Team OWNERS are the clearest case: a Sleeper
   * account is not a Dissent account and there is no mapping, so importing eight
   * owners would mean inventing eight accounts.
   */
  it('names rosters, draft, owners and history explicitly', () => {
    const text = notImported().join(' ').toLowerCase();
    for (const thing of ['roster', 'draft', 'owner', 'history']) {
      expect(text).toContain(thing);
    }
    expect(notImported().length).toBeGreaterThan(3);
  });

  it('is carried on every plan, including a valid one', () => {
    expect(planImport(big).notImported).toEqual(notImported());
  });
});

describe('the endpoints', () => {
  it('reads leagues from the one call that carries their settings', () => {
    expect(importUrls.leagues('123', 2026))
      .toBe('https://api.sleeper.app/v1/user/123/leagues/nfl/2026');
    expect(importUrls.user('ikrowni')).toBe('https://api.sleeper.app/v1/user/ikrowni');
  });

  // ⚠️ A username can contain characters a URL cannot.
  it('encodes the username', () => {
    expect(importUrls.user('a b/c')).toBe('https://api.sleeper.app/v1/user/a%20b%2Fc');
  });

  // The fixture is the proof that one request carries everything the mapper reads.
  it('the leagues endpoint really does carry full settings', () => {
    for (const l of leagues) {
      expect(l.settings).toBeTruthy();
      expect(l.scoring_settings).toBeTruthy();
      expect(Array.isArray(l.roster_positions)).toBe(true);
    }
  });
});
