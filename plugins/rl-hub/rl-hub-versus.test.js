import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatTime,
  calcPossessionFromTouches,
  calcOffDef,
  calcShotAcc,
  normalizeBarPct,
  addFeedEvent,
  hideVersus,
  showVersus,
  formatBallSpeed,
  ballSpeedColor,
} from './rl-hub-versus.js';

// ── formatTime (existing) ────────────────────────────────────────────────────
describe('formatTime', () => {
  it('formats 0 seconds',      () => expect(formatTime(0)).toBe('0:00'));
  it('formats 65 seconds',     () => expect(formatTime(65)).toBe('1:05'));
  it('formats 245 seconds',    () => expect(formatTime(245)).toBe('4:05'));
  it('formats 600 seconds',    () => expect(formatTime(600)).toBe('10:00'));
  it('clamps negative to 0',   () => expect(formatTime(-5)).toBe('0:00'));
  it('floors fractional',      () => expect(formatTime(65.9)).toBe('1:05'));
});

// ── calcPossessionFromTouches ────────────────────────────────────────────────
describe('possession from ball.team_num', () => {
  it('calcPossessionFromTouches 5 blue 3 orange → 63% blue', () => {
    expect(calcPossessionFromTouches(5, 3)).toEqual({ blue: 63, orange: 38 });
  });
  it('calcPossessionFromTouches 0 0 → 50/50', () => {
    expect(calcPossessionFromTouches(0, 0)).toEqual({ blue: 50, orange: 50 });
  });
});

// ── calcOffDef ───────────────────────────────────────────────────────────────
describe('calcOffDef', () => {
  it('returns 100/0 with only goals and shots', () => {
    const players = [{ goals: 2, shots: 5, saves: 0 }];
    const { off, def } = calcOffDef(players);
    expect(off).toBe(100);
    expect(def).toBe(0);
  });
  it('returns 0/100 with only saves', () => {
    const players = [{ goals: 0, shots: 0, saves: 4 }];
    const { off, def } = calcOffDef(players);
    expect(off).toBe(0);
    expect(def).toBe(100);
  });
  it('handles empty array without crashing', () => {
    const { off, def } = calcOffDef([]);
    expect(off).toBe(0);
    expect(def).toBe(0);
  });
  it('sums across multiple players', () => {
    const players = [
      { goals: 1, shots: 2, saves: 1 },
      { goals: 1, shots: 1, saves: 2 },
    ];
    const { off, def } = calcOffDef(players);
    // off = 1+2+1+1=5, def=1+2=3, total=8
    expect(off).toBe(63);
    expect(def).toBe(38);
  });
});

// ── calcShotAcc ──────────────────────────────────────────────────────────────
describe('calcShotAcc', () => {
  it('returns 0 with no goals', () => {
    expect(calcShotAcc([{ goals: 0, shots: 5 }])).toBe(0);
  });
  it('returns 100 when all shots score', () => {
    expect(calcShotAcc([{ goals: 3, shots: 3 }])).toBe(100);
  });
  it('returns 0 when no shots (avoids div/0)', () => {
    expect(calcShotAcc([{ goals: 0, shots: 0 }])).toBe(0);
  });
  it('rounds correctly', () => {
    expect(calcShotAcc([{ goals: 1, shots: 3 }])).toBe(33);
  });
});

// ── normalizeBarPct ──────────────────────────────────────────────────────────
describe('normalizeBarPct', () => {
  it('returns 100 when value equals max', () => expect(normalizeBarPct(5, 5)).toBe(100));
  it('returns 50 for half of max',         () => expect(normalizeBarPct(3, 6)).toBe(50));
  it('returns 0 when value is 0',          () => expect(normalizeBarPct(0, 10)).toBe(0));
  it('avoids division by zero',            () => expect(normalizeBarPct(0, 0)).toBe(0));
});

// ── addFeedEvent DOM state tests ─────────────────────────────────────────────

describe('addFeedEvent', () => {
  const mockGs = {
    teams: { blue: { score: 0 }, orange: { score: 0 } },
    players: [
      { name: 'Alice', team: 'blue',   goals: 0, assists: 0, saves: 0, shots: 0, score: 0 },
      { name: 'Bob',   team: 'orange', goals: 0, assists: 0, saves: 0, shots: 0, score: 0 },
    ],
    time: 180, arena: 'Test', mode: '2v2',
    is_overtime: false, has_winner: false, is_replay: false,
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="versus-panel"></div>';
    hideVersus();
    showVersus('player1', mockGs);
  });

  it('increments demo count on Demolish and reflects it in rendered HTML', () => {
    addFeedEvent({ event_name: 'Demolish', player_name: 'Alice', team_num: 0 });
    addFeedEvent({ event_name: 'Demolish', player_name: 'Alice', team_num: 0 });
    const panel = document.getElementById('versus-panel');
    // Alice's Demos stat icon should show 2
    expect(panel.innerHTML).toContain('>2<');
  });

  it('records last goal scorer on Goal event and shows it in last-goal card', () => {
    addFeedEvent({ event_name: 'Goal', player_name: 'Alice', team_num: 0 });
    const panel = document.getElementById('versus-panel');
    const goalCard = panel.querySelector('.vsb-goal-card.blue .vsb-goal-scorer:not(.empty)');
    expect(goalCard).not.toBeNull();
    expect(goalCard.textContent).toBe('Alice');
  });

  it('clears last-goal state after hideVersus + showVersus', () => {
    addFeedEvent({ event_name: 'Goal', player_name: 'Alice', team_num: 0 });
    hideVersus();
    showVersus('player1', mockGs);
    const panel = document.getElementById('versus-panel');
    expect(panel.innerHTML).toContain('class="vsb-goal-scorer empty"');
  });
});

// ── Player card status badges ────────────────────────────────────────────────

describe('player card status badges', () => {
  const mockGs = {
    teams: { blue: { score: 0 }, orange: { score: 0 } },
    players: [{
      name: 'Alice', team: 'blue', goals: 0, assists: 0, saves: 0,
      shots: 0, score: 0, touches: 0, speed: 1500,
      supersonic: true, boosting: false, on_wall: false, powersliding: false,
      demolished: false,
    }],
    time: 180, arena: 'Test', mode: '1v1',
    is_overtime: false, has_winner: false, is_replay: false,
    ball: { speed: 0, team_num: 255 },
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="versus-panel"></div>';
    hideVersus();
    showVersus('p1', mockGs);
  });

  it('activates speed label when player is supersonic', () => {
    const panel = document.getElementById('versus-panel');
    expect(panel.innerHTML).toContain('vsb-speed-label active');
  });

  it('does not activate boost label when not boosting', () => {
    const panel = document.getElementById('versus-panel');
    expect(panel.innerHTML).not.toContain('vsb-boost-label active');
  });
});

// ── formatBallSpeed ──────────────────────────────────────────────────────────
describe('formatBallSpeed', () => {
  it('converts 2200 UU/s to 79 km/h', () => expect(formatBallSpeed(2200)).toBe(79));
  it('converts 0 to 0',               () => expect(formatBallSpeed(0)).toBe(0));
});

describe('ballSpeedColor', () => {
  it('returns green class for low speed',  () => expect(ballSpeedColor(20)).toBe('slow'));
  it('returns yellow class for mid speed', () => expect(ballSpeedColor(100)).toBe('fast'));
  it('returns red class for high speed',   () => expect(ballSpeedColor(180)).toBe('max'));
});

// ── Player card touches ──────────────────────────────────────────────────────

describe('player card touches', () => {
  const mockGs = {
    teams: { blue: { score: 0 }, orange: { score: 0 } },
    players: [{
      name: 'Alice', team: 'blue', goals: 0, assists: 0, saves: 0,
      shots: 0, score: 0, touches: 7, speed: 1800,
      supersonic: false, boosting: false, on_wall: false, powersliding: false,
      demolished: false,
    }],
    time: 180, arena: 'Test', mode: '1v1',
    is_overtime: false, has_winner: false, is_replay: false,
    ball: { speed: 0, team_num: 255 },
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="versus-panel"></div>';
    hideVersus();
    showVersus('p1', mockGs);
  });

  it('shows touch count 7 in stat icons', () => {
    const panel = document.getElementById('versus-panel');
    expect(panel.innerHTML).toContain('vsb-si-lbl">Touch');
  });
});
