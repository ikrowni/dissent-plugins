import { describe, it, expect } from 'vitest';
import { splitRosterPositions } from './slots.js';
import {
  DEFAULT_SETTINGS, FORMAT, WAIVER_TYPE,
  normalizeSettings, validateSettings,
  isMultiSeason, requiresLineupSetting,
  setRosterShape, activeRosterSize, canApplySettings,
  MAX_BENCH_SLOTS, MAX_IR_SLOTS, MAX_DRAFT_ROUNDS,
} from './settings.js';


describe('defaults', () => {
  it('are a valid league on their own', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ valid: true, errors: [] });
  });
});

describe('normalizeSettings', () => {
  it('fills gaps without mutating the input', () => {
    const partial = { name: 'Dynasty Warriors', format: FORMAT.DYNASTY };
    const out = normalizeSettings(partial);
    expect(out.numTeams).toBe(12);
    expect(out.name).toBe('Dynasty Warriors');
    expect(partial.numTeams).toBeUndefined();
  });

  // ⚠️ Sharing a reference with the frozen defaults would let one league's edit
  // reach every other league seeded from them.
  it('copies the scoring map and roster positions rather than sharing them', () => {
    const a = normalizeSettings({});
    const b = normalizeSettings({});
    a.scoring.rec = 99;
    a.rosterPositions.push('BN');
    expect(b.scoring.rec).toBe(1);
    expect(b.rosterPositions).not.toContain(undefined);
    expect(b.rosterPositions.length).toBe(DEFAULT_SETTINGS.rosterPositions.length);
  });
});

describe('validateSettings', () => {
  const bad = (patch) => validateSettings({ ...DEFAULT_SETTINGS, ...patch });

  it('rejects a playoff bigger than the league', () => {
    const r = bad({ numTeams: 4, playoffTeams: 6 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds numTeams'))).toBe(true);
  });

  it('rejects playoffs starting before the season', () => {
    expect(bad({ startWeek: 15, playoffWeekStart: 15 }).valid).toBe(false);
  });

  it('rejects a trade deadline inside the playoffs', () => {
    const r = bad({ tradeDeadlineWeek: 16, playoffWeekStart: 15 });
    expect(r.errors.some((e) => e.includes('trade deadline'))).toBe(true);
  });

  it('rejects a FAAB league with no budget', () => {
    expect(bad({ waiverType: WAIVER_TYPE.FAAB, waiverBudget: 0 }).valid).toBe(false);
  });

  it('rejects more veto votes than there are teams', () => {
    expect(bad({ numTeams: 4, vetoVotesNeeded: 6 }).valid).toBe(false);
  });

  it('requires a median matchup for an odd number of teams', () => {
    expect(bad({ numTeams: 11 }).valid).toBe(false);
    expect(bad({ numTeams: 11, medianMatchup: true, vetoVotesNeeded: 4 }).valid).toBe(true);
  });

  // ⚠️ Silently meaningless settings are worse than rejected ones — a commissioner
  // sets maxKeepers on a redraft league and wonders all preseason why nobody can
  // keep anyone.
  it('rejects keeper and taxi settings that the format makes meaningless', () => {
    expect(bad({ format: FORMAT.REDRAFT, maxKeepers: 2 }).valid).toBe(false);
    expect(bad({ format: FORMAT.KEEPER, taxiSlots: 3 }).valid).toBe(false);
    expect(bad({ format: FORMAT.DYNASTY, taxiSlots: 3, maxKeepers: 2 }).valid).toBe(true);
  });

  it('rejects a roster with no starting slots', () => {
    expect(bad({ rosterPositions: ['BN', 'BN'] }).valid).toBe(false);
  });

  it('rejects unknown enums rather than silently defaulting', () => {
    expect(bad({ format: 'superflex' }).valid).toBe(false);
    expect(bad({ waiverType: 'blind' }).valid).toBe(false);
  });
});

describe('format predicates', () => {
  it('knows which formats carry rosters across seasons', () => {
    expect(isMultiSeason({ format: FORMAT.DYNASTY })).toBe(true);
    expect(isMultiSeason({ format: FORMAT.KEEPER })).toBe(true);
    expect(isMultiSeason({ format: FORMAT.REDRAFT })).toBe(false);
    expect(isMultiSeason(null)).toBe(false);
  });

  it('knows best ball never asks for a lineup', () => {
    expect(requiresLineupSetting({ bestBall: false })).toBe(true);
    expect(requiresLineupSetting({ bestBall: true })).toBe(false);
  });
});

describe('playoff bracket default', () => {
  // ⚠️ Sleeper's default keeps a team on the side of the bracket it was seeded
  // into; re-seeding each round is the opt-in. We shipped the opposite until
  // 2026-08-11. See docs/research/sleeper-parity-study.md §6.1.
  it('leaves teams on their side of the bracket, as Sleeper does', () => {
    expect(DEFAULT_SETTINGS.playoffReseed).toBe(false);
  });
});

describe('AutoSubs setting', () => {
  // Sleeper offers OFF/1/2/3 and defaults to OFF.
  it('ships with AutoSubs off', () => {
    expect(DEFAULT_SETTINGS.autoSubsPerWeek).toBe(0);
  });
});

describe('wave 4 settings', () => {
  it('defaults to one week per playoff round', () => {
    expect(DEFAULT_SETTINGS.playoffRoundFormat).toBe('one');
  });

  it('defaults to no positional limits', () => {
    expect(DEFAULT_SETTINGS.positionLimits).toEqual({});
  });

  // ⚠️ Same trap as `scoring`: a shared reference means one league's edit
  // silently edits every league seeded from the default.
  it('never shares the positionLimits reference with the defaults', () => {
    const a = normalizeSettings({});
    a.positionLimits.QB = 99;
    expect(DEFAULT_SETTINGS.positionLimits.QB).toBeUndefined();
    expect(normalizeSettings({}).positionLimits).toEqual({});
  });
});


describe('roster shape', () => {
  const base = normalizeSettings({});

  it('adds bench spots without touching the starters', () => {
    const out = setRosterShape(base, { bench: 10 });
    const { starters, bench } = splitRosterPositions(out.rosterPositions);
    expect(bench).toBe(10);
    expect(starters).toEqual(splitRosterPositions(base.rosterPositions).starters);
  });

  it('adds an IR slot on top of the active roster, not out of it', () => {
    const before = activeRosterSize(base);
    const out = setRosterShape(base, { ir: 1 });
    expect(out.irSlots).toBe(1);
    expect(activeRosterSize(out)).toBe(before);
  });

  it('leaves the bench alone when only IR is set', () => {
    const out = setRosterShape(base, { ir: 2 });
    expect(splitRosterPositions(out.rosterPositions).bench)
      .toBe(splitRosterPositions(base.rosterPositions).bench);
  });

  it('keeps the reserves at the end when the bench is resized', () => {
    const out = setRosterShape(setRosterShape(base, { ir: 1 }), { bench: 10 });
    const last = out.rosterPositions[out.rosterPositions.length - 1];
    expect(last).toBe('IR');
    expect(splitRosterPositions(out.rosterPositions).bench).toBe(10);
    expect(out.irSlots).toBe(1);
  });

  it('clamps a typo rather than building a roster nothing can render', () => {
    expect(splitRosterPositions(setRosterShape(base, { bench: 4000 }).rosterPositions).bench)
      .toBe(MAX_BENCH_SLOTS);
    expect(setRosterShape(base, { ir: 99 }).irSlots).toBe(MAX_IR_SLOTS);
  });

  it('never mutates the settings it was handed', () => {
    const before = [...base.rosterPositions];
    setRosterShape(base, { bench: 10, ir: 1 });
    expect(base.rosterPositions).toEqual(before);
  });
});

// ⚠️ THE BUG THIS EXISTS FOR: `irSlots` and the 'IR' entries in
// `rosterPositions` both described the IR compartment and nothing kept them
// equal. views/league-roster.js counted the array; ops-league.js and
// rosters.js enforced the number. Set one without the other and the node let a
// player onto IR that the roster screen had nowhere to draw — held, invisible.
describe('IR slots have one source of truth', () => {
  it('derives the slot list from the number', () => {
    const out = normalizeSettings({ irSlots: 2 });
    expect(splitRosterPositions(out.rosterPositions).ir).toBe(2);
  });

  it('takes the number from the list when only the list is given', () => {
    const out = normalizeSettings({ rosterPositions: ['QB', 'RB', 'BN', 'IR', 'IR'] });
    expect(out.irSlots).toBe(2);
  });

  it('lets the number win when both are given and they disagree', () => {
    const out = normalizeSettings({ rosterPositions: ['QB', 'RB', 'BN', 'IR', 'IR'], irSlots: 1 });
    expect(out.irSlots).toBe(1);
    expect(splitRosterPositions(out.rosterPositions).ir).toBe(1);
  });

  it('does not drop a stored irSlots on an unrelated save', () => {
    const stored = normalizeSettings({ irSlots: 1 });
    const saved = normalizeSettings({ ...stored, name: 'Renamed' });
    expect(saved.irSlots).toBe(1);
    expect(splitRosterPositions(saved.rosterPositions).ir).toBe(1);
  });

  it('applies the same rule to taxi', () => {
    const out = normalizeSettings({ format: FORMAT.DYNASTY, taxiSlots: 3 });
    expect(splitRosterPositions(out.rosterPositions).taxi).toBe(3);
  });
});

describe('draft settings are validated against the roster they fill', () => {
  it('refuses more rounds than there are roster spots', () => {
    const s = setRosterShape(normalizeSettings({}), { bench: 2 }); // 10 starters + 2
    const check = validateSettings({ ...s, draftRounds: 20 });
    expect(check.valid).toBe(false);
    expect(check.errors.join(' ')).toMatch(/12 roster spots/);
  });

  it('accepts a draft that exactly fills the roster', () => {
    const s = setRosterShape(normalizeSettings({}), { bench: 10 }); // 10 + 10
    expect(validateSettings({ ...s, draftRounds: 20 }).valid).toBe(true);
  });

  // ⚠️ IR is EXTRA capacity, so it must not buy an extra draft round — a team
  // cannot draft a healthy player straight onto injured reserve.
  it('does not let IR slots pay for extra rounds', () => {
    const s = setRosterShape(normalizeSettings({}), { bench: 10, ir: 3 });
    expect(validateSettings({ ...s, draftRounds: 23 }).valid).toBe(false);
    expect(validateSettings({ ...s, draftRounds: 20 }).valid).toBe(true);
  });

  it('refuses a rounds count that is not a whole number in range', () => {
    const s = normalizeSettings({});
    for (const rounds of [0, -1, 1.5, MAX_DRAFT_ROUNDS + 1]) {
      expect(validateSettings({ ...s, draftRounds: rounds }).valid).toBe(false);
    }
  });

  // 0 is a real setting — a slow/offline draft with no clock at all.
  it('accepts no pick clock but refuses a negative one', () => {
    const s = normalizeSettings({});
    expect(validateSettings({ ...s, pickTimerSeconds: 0 }).valid).toBe(true);
    expect(validateSettings({ ...s, pickTimerSeconds: -1 }).valid).toBe(false);
  });
});


describe('canApplySettings', () => {
  const base = setRosterShape(normalizeSettings({}), { bench: 6 }); // 10 starters + 6
  const roster = (n, ir = 0) => ({
    players: Array.from({ length: n }, (_, i) => `p${i}`),
    ir: Array.from({ length: ir }, (_, i) => `r${i}`),
    taxi: [],
  });

  it('allows a change that touches nothing structural', () => {
    const next = { ...base, name: 'Renamed', waiverBudget: 200 };
    expect(canApplySettings(base, next, { rosters: { t1: roster(16) } }).ok).toBe(true);
  });

  // The whole point of the feature: growing before a draft must never be blocked.
  it('always allows growing the bench and adding IR', () => {
    const next = setRosterShape(base, { bench: 10, ir: 1 });
    expect(canApplySettings(base, next, { rosters: { t1: roster(16) } }).ok).toBe(true);
  });

  it('refuses a shrink that would strand rostered players, naming the team', () => {
    const next = setRosterShape(base, { bench: 2 }); // capacity 12
    const res = canApplySettings(base, next, { rosters: { t1: roster(16) } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/t1/);
    expect(res.error).toMatch(/strand 4/);
  });

  it('refuses dropping IR slots out from under an injured player', () => {
    const withIr = setRosterShape(base, { ir: 2 });
    const res = canApplySettings(withIr, setRosterShape(withIr, { ir: 0 }), {
      rosters: { t1: roster(4, 2) },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/on IR/);
  });

  it('allows a shrink that strands nobody', () => {
    const next = setRosterShape(base, { bench: 2 }); // capacity 12
    expect(canApplySettings(base, next, { rosters: { t1: roster(11) } }).ok).toBe(true);
  });

  // ⚠️ Rounds/type/clock are baked into the board when the draft is built, so
  // changing them mid-draft moves the label and not the board.
  it('freezes the shape entirely while a draft is running', () => {
    const next = { ...base, draftRounds: 10 };
    for (const status of ['active', 'paused']) {
      const res = canApplySettings(base, next, { rosters: {}, draftStatus: status });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(new RegExp(status));
    }
  });

  it('allows the same change before the draft starts and after it finishes', () => {
    const next = { ...base, draftRounds: 10 };
    for (const status of [null, 'pre', 'complete']) {
      expect(canApplySettings(base, next, { rosters: {}, draftStatus: status }).ok).toBe(true);
    }
  });

  // A running draft must not block a plain rename — the shape has not moved.
  it('does not freeze non-structural settings during a draft', () => {
    const next = { ...base, name: 'Mid-draft rename' };
    expect(canApplySettings(base, next, { draftStatus: 'active' }).ok).toBe(true);
  });

  it('checks every team, not just the first', () => {
    const next = setRosterShape(base, { bench: 2 });
    const res = canApplySettings(base, next, { rosters: { t1: roster(5), t2: roster(16) } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/t2/);
  });
});

describe('draftScheduledAt', () => {
  const base = normalizeSettings({});

  it('defaults to unscheduled', () => {
    expect(base.draftScheduledAt).toBe(null);
  });

  it('accepts a millisecond timestamp or null', () => {
    expect(validateSettings({ ...base, draftScheduledAt: Date.UTC(2026, 8, 6, 20) }).valid).toBe(true);
    expect(validateSettings({ ...base, draftScheduledAt: null }).valid).toBe(true);
  });

  // ⚠️ SECONDS ARE THE LIKELY MISTAKE, and merely checking for a finite number
  // accepts them. A seconds timestamp lands in 1970 and renders as a draft that
  // already happened — which reads as data corruption rather than a unit error.
  it('refuses a seconds timestamp', () => {
    const check = validateSettings({ ...base, draftScheduledAt: 1788400800 });
    expect(check.valid).toBe(false);
    expect(check.errors.join(' ')).toMatch(/milliseconds/);
  });

  it('refuses values that are not a time at all', () => {
    for (const v of ['saturday', NaN, Infinity, {}]) {
      expect(validateSettings({ ...base, draftScheduledAt: v }).valid, String(v)).toBe(false);
    }
  });

  // Scheduling is advisory and independent of the board, so it must not be
  // caught by the structural freeze that guards rounds/type/clock.
  it('is not a structural change, so it can be set during a draft', () => {
    const next = { ...base, draftScheduledAt: Date.UTC(2026, 8, 6, 20) };
    expect(canApplySettings(base, next, { draftStatus: 'active' }).ok).toBe(true);
  });
});
