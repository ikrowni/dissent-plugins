import { describe, it, expect } from 'vitest';
import {
  normalizeTeamName, nameKey, nameTaken, checkTeamName, checkFileId,
  MAX_TEAM_NAME, FILE_ID_RE,
} from './team-identity.js';

// A real id, in the shape the node mints (uuid.New().String()).
const ID = '3f2b1a90-7c4d-4e11-9b2a-5d6e7f801234';

describe('normalizeTeamName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeTeamName('  The   Commish  ')).toBe('The Commish');
    expect(normalizeTeamName('A\t\tB\nC')).toBe('A B C');
  });

  it('survives absent input rather than throwing', () => {
    expect(normalizeTeamName(undefined)).toBe('');
    expect(normalizeTeamName(null)).toBe('');
  });
});

describe('nameTaken', () => {
  // ⚠️ THE FIXTURE'S CORRECT ANSWER CONTRADICTS THE NATURAL SORT OF ITS IDS.
  // `t9` sorts last and is the team that clashes; a lookup that happened to
  // return the first entry, or that relied on insertion order, would pass
  // against a fixture where the answer was `t1`. This repo has been bitten twice
  // by tests that passed by alphabetical accident.
  const teams = {
    t3: { id: 't3', name: 'Gridiron Ghosts' },
    t1: { id: 't1', name: 'Sunday Scaries' },
    t9: { id: 't9', name: 'The Commish' },
  };

  it('finds the clash regardless of case or spacing', () => {
    expect(nameTaken(teams, 'the commish')).toBe('t9');
    expect(nameTaken(teams, '  THE   COMMISH ')).toBe('t9');
  });

  it('returns null when nothing clashes', () => {
    expect(nameTaken(teams, 'Waiver Wire Warriors')).toBe(null);
  });

  it('does not let a team clash with itself — a re-case must be allowed', () => {
    expect(nameTaken(teams, 'THE COMMISH', 't9')).toBe(null);
  });

  it('still catches a clash with a DIFFERENT team while excluding your own', () => {
    expect(nameTaken(teams, 'Sunday Scaries', 't9')).toBe('t1');
  });

  it('treats an empty name as clashing with nothing', () => {
    // Emptiness is checkTeamName's refusal to make, not this one's — and an empty
    // key must never match a team whose name is somehow also empty.
    expect(nameTaken({ ...teams, t4: { id: 't4', name: '' } }, '   ')).toBe(null);
  });

  it('handles an absent team map', () => {
    expect(nameTaken(undefined, 'Anything')).toBe(null);
  });
});

describe('checkTeamName', () => {
  it('accepts and returns the normalized form', () => {
    expect(checkTeamName('  Sunday   Scaries ')).toEqual({ ok: true, name: 'Sunday Scaries' });
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(checkTeamName('').ok).toBe(false);
    expect(checkTeamName('   ').ok).toBe(false);
    expect(checkTeamName(undefined).ok).toBe(false);
  });

  it('accepts exactly the limit and refuses one past it', () => {
    expect(checkTeamName('x'.repeat(MAX_TEAM_NAME)).ok).toBe(true);
    const over = checkTeamName('x'.repeat(MAX_TEAM_NAME + 1));
    expect(over.ok).toBe(false);
    // The refusal names the limit AND the actual length — "too long" alone leaves
    // somebody trimming one character at a time.
    expect(over.error).toContain(String(MAX_TEAM_NAME));
    expect(over.error).toContain(String(MAX_TEAM_NAME + 1));
  });

  it('measures the length AFTER collapsing whitespace', () => {
    // 60 characters of content separated by runs of spaces is a legal name, and
    // measuring the raw string would refuse it.
    const spaced = 'x'.repeat(30) + '    ' + 'y'.repeat(29);
    expect(spaced.length).toBeGreaterThan(MAX_TEAM_NAME);
    expect(checkTeamName(spaced).ok).toBe(true);
  });

  it('never truncates — a too-long name is refused, not silently shortened', () => {
    const res = checkTeamName('x'.repeat(200));
    expect(res.ok).toBe(false);
    expect(res.name).toBeUndefined();
  });
});

describe('checkFileId', () => {
  it('accepts a node-minted uuid and lowercases it', () => {
    expect(checkFileId(ID)).toEqual({ ok: true, fileId: ID });
    expect(checkFileId(ID.toUpperCase())).toEqual({ ok: true, fileId: ID });
  });

  it('treats an empty string as a deliberate clear', () => {
    expect(checkFileId('')).toEqual({ ok: true, fileId: '' });
    expect(checkFileId('   ')).toEqual({ ok: true, fileId: '' });
  });

  // ⚠️ THE WHOLE POINT OF STORING AN ID. Every one of these is something that
  // would render as an image from somebody else's host if the field held a URL —
  // a tracking pixel firing for the entire league on every standings paint.
  it.each([
    ['an absolute http url', 'http://evil.example/pixel.gif'],
    ['an https url', 'https://evil.example/pixel.gif'],
    ['a protocol-relative url', '//evil.example/pixel.gif'],
    ['a data url', 'data:image/gif;base64,R0lGOD'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a node-looking url that merely CONTAINS an id', `https://evil.example/${ID}.png`],
    ['a path traversal', '../../../etc/passwd'],
    ['a uuid with something appended', `${ID}?x=1`],
    ['a uuid with something prepended', `x${ID}`],
    ['a uuid missing a section', '3f2b1a90-7c4d-4e11-9b2a'],
    ['non-hex characters', '3f2b1a90-7c4d-4e11-9b2a-5d6e7f80zzzz'],
  ])('refuses %s', (_label, value) => {
    const res = checkFileId(value, 'avatar');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('avatar');
  });

  it('labels the field it refused, so two pickers give two different messages', () => {
    expect(checkFileId('nope', 'banner').error).toContain('banner');
    expect(checkFileId('nope', 'avatar').error).toContain('avatar');
  });

  it('truncates a long rejected value in the message rather than echoing it whole', () => {
    const res = checkFileId('z'.repeat(5000), 'avatar');
    expect(res.ok).toBe(false);
    expect(res.error.length).toBeLessThan(200);
  });
});

describe('FILE_ID_RE', () => {
  it('is anchored at both ends', () => {
    // An unanchored pattern is the single mistake that would let every url above
    // through, so it is asserted directly rather than only through checkFileId.
    expect(FILE_ID_RE.source.startsWith('^')).toBe(true);
    expect(FILE_ID_RE.source.endsWith('$')).toBe(true);
  });

  it('carries no global flag — a lastIndex would make alternate calls fail', () => {
    expect(FILE_ID_RE.global).toBe(false);
    expect(FILE_ID_RE.test(ID)).toBe(true);
    expect(FILE_ID_RE.test(ID)).toBe(true);
  });
});

describe('nameKey', () => {
  it('agrees with normalizeTeamName plus a lowercase', () => {
    expect(nameKey('  The   COMMISH ')).toBe('the commish');
  });
});
