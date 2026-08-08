// core/ufc-cloudfront.js — UFC's own event API.
//
// The richest source available and already allowlisted. One document (26 KB upcoming,
// 76 KB final) carries the whole card: both fighters with records and physicals, the
// card segment and broadcaster, referee, results with judge scorecards, and the
// FightNightTracking play-by-play timeline (parsed separately in fight-timeline.js).
//
// Measured 2026-08-08 against events 1324 (upcoming) and 1320 (final).

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** CloudFront Status is a display string; views want the three-state vocabulary. */
function stateOf(status) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'final' || s === 'completed') return 'post';
  if (s === 'live' || s === 'inprogress' || s === 'in progress') return 'in';
  return 'pre';
}

function parseFighter(f) {
  const n = f?.Name ?? {};
  const rec = f?.Record ?? null;
  return {
    fighterId: num(f?.FighterId),
    mmaId: num(f?.MMAId),
    name: `${n.FirstName ?? ''} ${n.LastName ?? ''}`.trim() || 'TBD',
    firstName: n.FirstName ?? '',
    lastName: n.LastName ?? '',
    nickName: n.NickName ?? null,
    corner: f?.Corner ?? null,
    record: rec ? {
      wins: num(rec.Wins) ?? 0,
      losses: num(rec.Losses) ?? 0,
      draws: num(rec.Draws) ?? 0,
      noContests: num(rec.NoContests) ?? 0,
    } : null,
    age: num(f?.Age),
    height: num(f?.Height),
    reach: num(f?.Reach),
    weighIn: num(f?.WeighIn),
    stance: f?.Stance ?? null,
    fightingOutOf: f?.FightingOutOf ?? null,
    born: f?.Born ?? null,
    // Outcome is { OutcomeId, Outcome }, not a bare string.
    outcome: f?.Outcome?.Outcome ?? null,
    ufcLink: f?.UFCLink ?? null,
  };
}

function parseResult(r) {
  if (!r) return null;
  return {
    method: r.Method ?? null,
    endingRound: num(r.EndingRound),
    endingTime: r.EndingTime ?? null,
    endingStrike: r.EndingStrike ?? null,
    endingTarget: r.EndingTarget ?? null,
    endingPosition: r.EndingPosition ?? null,
    endingSubmission: r.EndingSubmission ?? null,
    endingNotes: r.EndingNotes ?? null,
    fightOfTheNight: r.FightOfTheNight === true,
    scores: (r.FightScores ?? []).map((s) => ({
      judge: `${s.JudgeFirstName ?? ''} ${s.JudgeLastName ?? ''}`.trim(),
      fighters: (s.Fighters ?? []).map((x) => ({
        fighterId: num(x.FighterId), score: num(x.Score),
      })),
    })),
  };
}

function parseFight(f) {
  const fighters = (f?.Fighters ?? []).map(parseFighter);
  // Corner is 'Red'/'Blue'; fall back to array order when it is absent.
  const red = fighters.find((x) => x.corner === 'Red') ?? fighters[0] ?? null;
  const blue = fighters.find((x) => x.corner === 'Blue') ?? fighters[1] ?? null;
  return {
    fightId: num(f?.FightId),
    order: num(f?.FightOrder),
    status: f?.Status ?? null,
    state: stateOf(f?.Status),
    weightClass: f?.WeightClass?.Description ?? null,
    segment: f?.CardSegment ?? 'Main',
    segmentStart: f?.CardSegmentStartTime ?? null,
    broadcaster: f?.CardSegmentBroadcaster ?? null,
    referee: f?.Referee
      ? `${f.Referee.FirstName ?? ''} ${f.Referee.LastName ?? ''}`.trim()
      : null,
    ruleSet: f?.RuleSet?.Description ?? null,
    // Measured as [] on every fight of the fixture card. Never populated, so nothing is
    // derived from its element shape.
    accolades: Array.isArray(f?.Accolades) ? f.Accolades : [],
    red,
    blue,
    fighters,
    result: parseResult(f?.Result),
    tracking: Array.isArray(f?.FightNightTracking) ? f.FightNightTracking : [],
  };
}

export function parseEvent(json) {
  const e = json?.LiveEventDetail;
  if (!e || typeof e !== 'object') return null;
  return {
    eventId: num(e.EventId),
    name: e.Name ?? 'UFC Event',
    startTime: e.StartTime ?? null,
    timeZone: e.TimeZone ?? null,
    status: e.Status ?? null,
    state: stateOf(e.Status),
    location: e.Location ?? null,
    liveFightId: num(e.LiveFightId),
    liveRound: num(e.LiveRoundNumber),
    liveRoundElapsed: e.LiveRoundElapsedTime ?? null,
    fights: (e.FightCard ?? []).map(parseFight),
  };
}

// ⚠️ MEASURED SEGMENT VALUES: the payload says 'Main' and 'Prelims1' — NOT 'Main Card',
// 'Prelims' or 'Early Prelims'. Both fixtures agree. An earlier draft of this map keyed on
// 'Main Card', which sent 'Main' to the `?? 9` fallback and rendered the MAIN CARD BELOW
// THE PRELIMS. Keep the raw payload keys here and translate for display separately.
const SEGMENT_RANK = {
  Main: 0, Main1: 0, Prelims1: 1, Prelims: 1, Prelims2: 2, 'Early Prelims': 2,
};

/** Raw payload segment -> what a viewer expects to read. */
const SEGMENT_LABEL = {
  Main: 'Main Card', Main1: 'Main Card',
  Prelims1: 'Prelims', Prelims: 'Prelims',
  Prelims2: 'Early Prelims', 'Early Prelims': 'Early Prelims',
};

export function segmentLabel(seg) {
  return SEGMENT_LABEL[seg] ?? seg ?? 'Main Card';
}

/** Group into display segments: main card first, then prelims, then early prelims. */
export function cardSegments(fights) {
  const bySeg = new Map();
  for (const f of fights ?? []) {
    const key = f.segment ?? 'Main';
    if (!bySeg.has(key)) bySeg.set(key, []);
    bySeg.get(key).push(f);
  }
  return [...bySeg.entries()]
    .sort((a, b) => (SEGMENT_RANK[a[0]] ?? 9) - (SEGMENT_RANK[b[0]] ?? 9))
    .map(([segment, list]) => ({
      segment,
      label: segmentLabel(segment),
      broadcaster: list[0]?.broadcaster ?? null,
      startTime: list[0]?.segmentStart ?? null,
      // FightOrder counts UP from the main event, so ascending puts the headliner first.
      fights: list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
}
