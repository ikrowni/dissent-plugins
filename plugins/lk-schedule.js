// lk-schedule.js — "Next session": the DM offers a few times, players say which they can make, the DM picks one,
// and the table is reminded the day before (owner, 2026-10-07; research: scheduling is what ends most campaigns).
//
// ⚠️ SOURCE; vendored into dnd-hub and dnd-master (scripts/vendor-shared.mjs).
//
// The question lives in the campaign (`campaign.nextSession`, written by the DM). Each player's answer lives in its
// own server key (`voteKey`), so two players answering at once can never overwrite each other.

export const MAX_OPTIONS = 4;
const H = 3600000;

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const time = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

/** The DM's question as it may be stored, or null. Past times go (except the chosen one: the session is today). */
export function cleanNextSession(s, now = Date.now()) {
  const id = str(s?.id, 40);
  if (!id) return null;
  const chosen = str(s.chosenId, 40) || null;
  const options = (Array.isArray(s.options) ? s.options : [])
    .map(o => ({ id: str(o?.id, 40), at: time(o?.at) }))
    .filter(o => o.id && o.at && (o.at > now || o.id === chosen))
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_OPTIONS);
  return { id, options, note: str(s.note, 200), chosenId: options.some(o => o.id === chosen) ? chosen : null,
    askedAt: time(s.askedAt) };
}

export const voteKey = (campaignId, sessionId, userId) => `sched-vote-${campaignId}-${sessionId}-${userId}`;

/** A player's answer, if it is for this question: only this question's times, each once. */
export function cleanVote(v, ns) {
  if (!v || !ns || v.sessionId !== ns.id) return null;
  const ids = new Set(ns.options.map(o => o.id));
  return { sessionId: ns.id, picks: [...new Set((Array.isArray(v.picks) ? v.picks : []).filter(p => ids.has(p)))], name: str(v.name, 40) };
}

/** Each time with who can make it; `best` marks the time most can make (the earliest on a tie), once anyone voted. */
export function tally(ns, votes) {
  const rows = (ns?.options || []).map(o => ({ ...o, names: [] }));
  for (const raw of Object.values(votes || {})) {
    const v = cleanVote(raw, ns);
    if (v) for (const r of rows) if (v.picks.includes(r.id)) r.names.push(v.name || 'A player');
  }
  const top = Math.max(0, ...rows.map(r => r.names.length));
  const best = top ? rows.find(r => r.names.length === top) : null;
  return rows.map(r => ({ ...r, best: r === best }));
}

export const chosenOption = ns => ns?.options?.find(o => o.id === ns.chosenId) || null;

/** A reminder is due in the last day before the chosen time, once per question (`remindedFor` = the last id reminded). */
export function reminderDue(ns, now, remindedFor) {
  const o = chosenOption(ns);
  return !!o && remindedFor !== ns.id && now < o.at && o.at - now <= 24 * H;
}

/** "in 2 days", "in 5 h 20 min", "in 30 min", "now". */
export function untilText(at, now = Date.now()) {
  const ms = at - now;
  if (ms <= 0) return 'now';
  const days = Math.floor(ms / (24 * H));
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  const h = Math.floor(ms / H), min = Math.floor((ms % H) / 60000);
  return h ? `in ${h} h${min ? ` ${min} min` : ''}` : `in ${min} min`;
}

/** A time as the DM sees it, with their offset, for the channel (chat has no "show in your own time" markup). */
export function dmTimeText(at, locale = undefined) {
  const d = new Date(at);
  const day = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const clock = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${day}, ${clock} (DM's time, UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''})`;
}

/** What the plugin bot posts to the campaign's channel. */
export function postText(kind, { campaignName, count = 0, when = '' }) {
  const name = `**${campaignName || 'The campaign'}**`;
  if (kind === 'ask') return `📅 ${name} — when can you play next? The DM offered ${count} times. Open LanternKeep and tick the ones that work for you.`;
  if (kind === 'chosen') return `📅 ${name} — next session: ${when}. Open LanternKeep to see it in your own time.`;
  return `⏰ ${name} — less than a day to go: ${when}.`;
}
