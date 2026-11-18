// core/draft-schedule.js — when the draft is, in the reader's own timezone.
//
// PURE, and CLIENT-ONLY. `core/league/*` is bundled into the server module;
// this is not, because a formatter that exists to render a local clock has no
// business inside a WASM module whose clock is UTC and whose reader is nobody.
//
// ⚠️ THE STORED VALUE IS EPOCH MILLISECONDS, ALWAYS UTC. A league has managers
// in different timezones — that is the entire reason the feature was asked for —
// so storing "8pm" or an offset-less local string would mean the draft happened
// at a different moment for each of them. Every reader converts the one instant
// into their own zone, and the zone is NAMED on screen so nobody has to assume.

/** Milliseconds in the units we care about, largest first. */
const UNITS = [
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
];

/**
 * Epoch ms → the value a `<input type="datetime-local">` wants.
 *
 * ⚠️ NOT `toISOString().slice(0,16)`. That is UTC, and a datetime-local input
 * is read as LOCAL — so round-tripping through it would shift the draft by the
 * reader's offset every single time they opened the settings form and saved it.
 * A commissioner in New York would have walked the draft four hours earlier per
 * visit without touching the field.
 */
export function toLocalInputValue(epochMs) {
  if (!Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The value of a `<input type="datetime-local">` → epoch ms.
 *
 * An empty field means "no draft time set", which is a legitimate state and
 * must clear the setting rather than store a NaN or an epoch of 0.
 */
export function fromLocalInputValue(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  // `new Date('2026-09-06T20:00')` — no trailing Z, no offset — is parsed as
  // local time, which is exactly what the input meant.
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How far away the draft is, in words.
 *
 * ⚠️ "in 2 days" IS NOT ENOUGH ON ITS OWN and is never shown alone — see
 * `formatDraftTime`. A relative time cannot be written in a calendar, and the
 * whole point of the feature is that people can.
 */
export function relativeTo(epochMs, now = Date.now()) {
  if (!Number.isFinite(epochMs)) return '';
  const diff = epochMs - now;
  const ahead = diff >= 0;
  const abs = Math.abs(diff);

  if (abs < 60000) return ahead ? 'starting now' : 'started just now';
  for (const [name, size] of UNITS) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      const unit = `${name}${n === 1 ? '' : 's'}`;
      return ahead ? `in ${n} ${unit}` : `${n} ${unit} ago`;
    }
  }
  return ahead ? 'starting now' : 'started just now';
}

/**
 * The draft time as a reader in this browser should see it.
 *
 * Returns null when nothing is scheduled — an absent time is a normal state,
 * not an error, and the caller renders nothing rather than "Invalid Date".
 *
 * ⚠️ THE TIMEZONE IS PART OF THE ANSWER. `timeZoneName: 'short'` puts EDT/PST/GMT+1
 * on the end. Without it two managers comparing screenshots see two different
 * times for one draft and have no way to tell which of them is wrong.
 */
export function formatDraftTime(epochMs, now = Date.now(), locale = undefined) {
  if (!Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;

  let absolute;
  try {
    absolute = d.toLocaleString(locale, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    // An environment without full ICU still has to render something a person
    // can read; a thrown formatter must not take the draft board down with it.
    absolute = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  return {
    absolute,
    relative: relativeTo(epochMs, now),
    past: epochMs < now,
  };
}
