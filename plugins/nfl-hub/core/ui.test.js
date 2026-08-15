// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  esc, chip, tile, panel, badge, sparkline, cmpRow, stateMsg, legibleColor, errorPane, noLeaguePane,
} from './ui.js';
import { TEAMS } from './config.js';
import { fmtClock, fmtSpread, fmtPct, fmtRecord, ordinalDown, fmtMoneyline } from './format.js';

const parse = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('esc', () => {
  it('neutralises markup', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;');
  });
  it('escapes quotes so it is safe inside an attribute', () => {
    expect(esc('a"b')).toContain('&quot;');
    expect(esc("a'b")).toContain('&#39;');
  });
  it('stringifies nullish to empty', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('passes numbers through', () => {
    expect(esc(24)).toBe('24');
    expect(esc(0)).toBe('0');
  });
});

describe('format', () => {
  it('formats a game clock and period', () => {
    expect(fmtClock(3, '7:42')).toBe('Q3 · 7:42');
    expect(fmtClock(5, '2:00')).toBe('OT · 2:00');
    expect(fmtClock(null, null)).toBe('');
  });
  it('formats a period with no clock', () => {
    expect(fmtClock(2, null)).toBe('Q2');
  });
  it('formats a spread from the favourite side', () => {
    expect(fmtSpread(-3.5)).toBe('-3.5');
    expect(fmtSpread(3.5)).toBe('+3.5');
    expect(fmtSpread(0)).toBe('PK');
    expect(fmtSpread(null)).toBe('—');
  });
  it('formats percentages with no float artefacts', () => {
    expect(fmtPct(67.6)).toBe('68%');
    expect(fmtPct(0.5)).toBe('1%');
    expect(fmtPct(null)).toBe('—');
  });
  it('formats a moneyline with an explicit plus', () => {
    expect(fmtMoneyline(-120)).toBe('-120');
    expect(fmtMoneyline(105)).toBe('+105');
    expect(fmtMoneyline(null)).toBe('—');
  });
  it('passes a record through, or blanks it', () => {
    expect(fmtRecord('3-1')).toBe('3-1');
    expect(fmtRecord(null)).toBe('');
  });
  it('renders down and distance', () => {
    expect(ordinalDown(1, 10)).toBe('1st & 10');
    expect(ordinalDown(2, 6)).toBe('2nd & 6');
    expect(ordinalDown(3, 1)).toBe('3rd & 1');
    expect(ordinalDown(4, 15)).toBe('4th & 15');
    expect(ordinalDown(null, null)).toBe('');
  });
  it('renders a down with no distance', () => {
    expect(ordinalDown(2, null)).toBe('2nd');
  });
});

describe('legibleColor', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  it('lifts pure black to something visible on a near-black background', () => {
    const out = legibleColor('#000000');
    expect(out).not.toBe('#000000');
    expect(lum(out)).toBeGreaterThanOrEqual(0.22);
  });

  it('leaves an already-bright colour alone', () => {
    expect(legibleColor('#ffb612')).toBe('#ffb612');
  });

  it('makes every one of the 32 team primaries legible', () => {
    // Raiders and Steelers are #000000, Houston #021018, Chicago #0b1c3a — a 2px
    // stroke in any of those is invisible on #05070b.
    for (const t of Object.values(TEAMS)) {
      expect(lum(legibleColor(t.primary))).toBeGreaterThanOrEqual(0.21);
    }
  });

  it('keeps the hue recognisable rather than swapping in a generic accent', () => {
    // Houston is a very dark navy; lifting it must stay blue-dominant, not go grey.
    const out = legibleColor('#021018');
    const [r, , b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });

  it('passes junk through rather than throwing', () => {
    expect(legibleColor(null)).toBe('var(--text-2)');
    expect(legibleColor('nope')).toBe('nope');
  });

  it('accepts a hex with no leading hash', () => {
    expect(legibleColor('ffb612')).toBe('#ffb612');
  });
});

describe('chip', () => {
  const side = { abbr: 'KC', name: 'Chiefs', fullName: 'Kansas City Chiefs',
    record: '1-0', logo: 'assets/logos/kc.png' };

  it('renders a local logo and the abbreviation', () => {
    const el = parse(chip(side));
    const img = el.querySelector('img');
    expect(img.getAttribute('src')).toBe('assets/logos/kc.png');
    expect(img.getAttribute('src')).not.toContain('espncdn');
    expect(el.textContent).toContain('KC');
  });

  it('carries the team abbr as a delegation target when clickable', () => {
    const el = parse(chip(side, { clickable: true }));
    const btn = el.querySelector('[data-act="team"]');
    expect(btn).not.toBeNull();
    expect(btn.dataset.team).toBe('KC');
  });

  it('is not a button when not clickable, so it cannot be tabbed to', () => {
    expect(parse(chip(side)).querySelector('button')).toBeNull();
  });

  it('escapes a hostile team name', () => {
    const el = parse(chip({ ...side, abbr: '<script>x</script>' }));
    expect(el.querySelector('script')).toBeNull();
  });

  it('omits the record when absent or suppressed', () => {
    expect(parse(chip({ ...side, record: null })).querySelector('.rec')).toBeNull();
    expect(parse(chip(side, { showRecord: false })).querySelector('.rec')).toBeNull();
  });

  it('returns empty string for no side', () => {
    expect(chip(null)).toBe('');
  });
});

describe('tile', () => {
  it('renders a label and value', () => {
    const el = parse(tile('Total yards', '312'));
    expect(el.querySelector('.label').textContent).toBe('Total yards');
    expect(el.querySelector('.value').textContent).toBe('312');
  });
  it('marks a good value', () => {
    expect(parse(tile('3rd down', '6/9', { good: true })).querySelector('.value.good')).not.toBeNull();
  });
});

describe('panel', () => {
  it('wraps body content with a heading', () => {
    const el = parse(panel({ title: 'Standings', body: '<p>x</p>' }));
    expect(el.querySelector('.panel-head h2').textContent).toBe('Standings');
    expect(el.querySelector('.panel-body p')).not.toBeNull();
  });
  it('supports a flush body for tables', () => {
    expect(parse(panel({ title: 'T', body: '', flush: true }))
      .querySelector('.panel-body.flush')).not.toBeNull();
  });
  it('renders right-hand content when given', () => {
    expect(parse(panel({ title: 'T', body: '', right: '<b>r</b>' }))
      .querySelector('.panel-head .right b')).not.toBeNull();
  });
  it('escapes the title', () => {
    expect(parse(panel({ title: '<script>x</script>', body: '' })).querySelector('script')).toBeNull();
  });
});

describe('badge', () => {
  it('renders a live badge with a pulsing dot', () => {
    const el = parse(badge('in'));
    expect(el.querySelector('.badge.live')).not.toBeNull();
    expect(el.querySelector('.live-dot')).not.toBeNull();
  });
  it('renders final without a dot', () => {
    const el = parse(badge('post'));
    expect(el.querySelector('.badge.final')).not.toBeNull();
    expect(el.querySelector('.live-dot')).toBeNull();
  });
  it('renders a scheduled state', () => {
    expect(parse(badge('pre')).textContent.trim().length).toBeGreaterThan(0);
  });
  it('escapes a supplied detail string', () => {
    expect(parse(badge('post', '<script>x</script>')).querySelector('script')).toBeNull();
  });
});

describe('stateMsg', () => {
  it('renders a spinner when asked', () => {
    expect(parse(stateMsg('Loading', { spinner: true })).querySelector('.spinner')).not.toBeNull();
  });
  it('renders a retry button when asked', () => {
    expect(parse(stateMsg('Failed', { retry: true })).querySelector('[data-act="retry"]')).not.toBeNull();
  });
  it('escapes the message', () => {
    expect(parse(stateMsg('<script>x</script>')).querySelector('script')).toBeNull();
  });
});

describe('sparkline', () => {
  it('emits a polyline with one point per value', () => {
    const el = parse(sparkline([1, 2, 3, 4]));
    const pts = el.querySelector('polyline').getAttribute('points').trim().split(/\s+/);
    expect(pts).toHaveLength(4);
  });

  it('renders nothing for fewer than two points, rather than a broken svg', () => {
    expect(sparkline([])).toBe('');
    expect(sparkline([5])).toBe('');
    expect(sparkline(null)).toBe('');
  });

  it('never emits NaN when every value is identical', () => {
    const el = parse(sparkline([50, 50, 50]));
    expect(el.querySelector('polyline').getAttribute('points')).not.toContain('NaN');
  });

  it('drops non-numeric values rather than emitting NaN', () => {
    const el = parse(sparkline([1, 'x', 3, null, 5]));
    const pts = el.querySelector('polyline').getAttribute('points');
    expect(pts).not.toContain('NaN');
    expect(pts.trim().split(/\s+/)).toHaveLength(3);
  });

  it('rounds coordinates so the markup stays small', () => {
    const pts = parse(sparkline([1, 7, 3])).querySelector('polyline').getAttribute('points');
    expect(pts).not.toMatch(/\.\d{3,}/);
  });
});

describe('cmpRow', () => {
  it('sizes both bars against the pair total', () => {
    const el = parse(cmpRow('Total yards', 300, 100, '#f00', '#00f'));
    const [l, r] = el.querySelectorAll('.cmp-bar i');
    expect(l.getAttribute('style')).toContain('75%');
    expect(r.getAttribute('style')).toContain('25%');
  });

  it('splits evenly when both sides are zero, rather than dividing by zero', () => {
    const el = parse(cmpRow('Turnovers', 0, 0, '#f00', '#00f'));
    for (const i of el.querySelectorAll('.cmp-bar i')) {
      expect(i.getAttribute('style')).toContain('50%');
    }
  });

  it('coerces a non-numeric stat like a possession time without emitting NaN', () => {
    const el = parse(cmpRow('Time of poss.', '18:04', '11:56', '#f00', '#00f'));
    expect(el.innerHTML).not.toContain('NaN');
    // The original strings are still what the user reads.
    expect(el.textContent).toContain('18:04');
    expect(el.textContent).toContain('11:56');
  });

  it('escapes the label and the values', () => {
    const el = parse(cmpRow('<script>a</script>', '<script>b</script>', 1, '#f00', '#00f'));
    expect(el.querySelector('script')).toBeNull();
  });
});

// ── The failed-load pane ────────────────────────────────────────────────────
describe('errorPane', () => {
  it('offers a retry for a real failure', () => {
    const el = parse(errorPane('fetch failed: timeout', 'Could not load the scoreboard.'));
    expect(el.textContent).toContain('Could not load the scoreboard.');
    expect(el.querySelector('[data-act="retry"]')).not.toBeNull();
  });

  // ⚠️ THE POINT. A viewer who chose "View Without Joining" granted nothing, so
  // the node refuses every call. "Try again" there is a button that can never
  // work — it just re-refuses.
  it('explains a permission refusal instead of offering an impossible retry', () => {
    const el = parse(errorPane('fetch failed: fetch:external not granted', 'Could not load the scoreboard.'));
    expect(el.querySelector('[data-act="retry"]')).toBeNull();
    expect(el.textContent).toMatch(/without joining|anonymously/i);
    expect(el.textContent).not.toContain('Could not load the scoreboard.');
  });

  it('tells the viewer how to turn live data on', () => {
    const el = parse(errorPane('fetch:external not granted', 'x'));
    // The consent card's own wording, so the instruction matches what they will see.
    expect(el.textContent).toMatch(/User Settings/i);
    expect(el.textContent).toMatch(/Privacy/i);
  });

  it('escapes the fallback rather than rendering it as markup', () => {
    const el = parse(errorPane('boom', '<img src=x onerror=1>'));
    expect(el.querySelector('img')).toBeNull();
  });
});

// ── No league in context ────────────────────────────────────────────────────
describe('noLeaguePane', () => {
  it('says there is no league rather than making a claim about your team', () => {
    const el = parse(noLeaguePane('My Roster'));
    expect(el.textContent).toMatch(/no league/i);
    // The two falsehoods it replaces.
    expect(el.textContent).not.toMatch(/do not have a team/i);
    expect(el.textContent).not.toMatch(/season has not started/i);
  });

  it('points at the tab that can actually fix it', () => {
    expect(parse(noLeaguePane('Moves')).textContent).toMatch(/League tab/i);
  });

  it('keeps the panel title it was given', () => {
    expect(noLeaguePane('Matchups')).toContain('Matchups');
  });

  it('escapes the title', () => {
    expect(parse(noLeaguePane('<img src=x>')).querySelector('img')).toBeNull();
  });
});
