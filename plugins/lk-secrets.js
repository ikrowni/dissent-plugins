// lk-secrets.js — what of a campaign only the DM may read, and what a live event may carry to every screen.
//
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs).
//
// 🔴 A campaign lives in dnd-hub's SERVER-scope plugin data, which every member of the server can read. Read as a
// player (bob_qa, 2026-10-03) it returned the DM's notes, prepared fights, traps, hidden monsters, DM-only pins and
// unshared journals. The DM's screen now splits each save: the public part stays in `hub-camp-<id>`, the secret
// part goes to the DM's own USER-scope `dm-camp-<id>`. Spec: docs/superpowers/specs/2026-10-03-lanternkeep-dm-secrets-design.md
// Pure: no storage, no DOM.

// bookFiles: the DM's library file per attached book (private; players get only the player part's copy).
// safetyByUser: who asked for which lines and veils (lk-safety.js) — the table sees only the combined, nameless list.
// prep: the DM's session prep board (lk-prep.js).
const TOP_SECRET = ['dmNotes', 'encounters', 'scenes', 'bookFiles', 'safetyByUser', 'prep'];
const clone = v => JSON.parse(JSON.stringify(v));
const isSharedJournal = j => j?.visibility === 'player';
const isSharedPin = p => p?.visible === 'all';
const isHiddenToken = t => t?.visible === false;

export const secretKey = campaignId => `dm-camp-${campaignId}`;

/** True when `userId` runs this campaign. Only the DM's screen splits, joins or writes the secret part. */
export function isCampaignDm(camp, userId) {
  return !!(camp && userId && camp.dmUserId === userId);
}

/**
 * `{ pub, sec }`: the record every member may read, and the DM's part (null when nothing is secret).
 * `pub.secretsKept` marks a record whose secrets have moved, so a null read of the secret part is known to be a
 * failed read, not an empty one.
 */
export function splitCampaign(camp) {
  const pub = clone(camp);
  const sec = {};
  for (const k of TOP_SECRET) {
    if (k in pub) { sec[k] = pub[k]; delete pub[k]; }
  }
  if (pub.journals && typeof pub.journals === 'object') {
    for (const [id, j] of Object.entries(pub.journals)) {
      if (!isSharedJournal(j)) { (sec.journals ||= {})[id] = j; delete pub.journals[id]; }
    }
  }
  for (const [mid, m] of Object.entries(pub.maps || {})) {
    if (!m || typeof m !== 'object') continue;
    const sm = {};
    for (const [tid, t] of Object.entries(m.tokens || {})) {
      if (isHiddenToken(t)) { (sm.tokens ||= {})[tid] = t; delete m.tokens[tid]; }
    }
    if (Array.isArray(m.triggers) && m.triggers.length) { sm.triggers = m.triggers; m.triggers = []; }
    if (Array.isArray(m.pins)) {
      const hidden = m.pins.filter(p => !isSharedPin(p));
      if (hidden.length) { sm.pins = hidden; m.pins = m.pins.filter(isSharedPin); }
    }
    if (Object.keys(sm).length) (sec.maps ||= {})[mid] = sm;
  }
  pub.secretsKept = true;
  return { pub, sec: Object.keys(sec).length ? sec : null };
}

/** The DM's whole campaign from its two parts. A secret map whose public map is gone (deleted) is dropped. */
export function joinCampaign(pub, sec) {
  const out = clone(pub);
  if (!sec) return out;
  for (const k of TOP_SECRET) if (k in sec) out[k] = clone(sec[k]);
  if (sec.journals) out.journals = { ...clone(sec.journals), ...(out.journals || {}) };
  for (const [mid, sm] of Object.entries(sec.maps || {})) {
    const m = out.maps?.[mid];
    if (!m) continue;
    if (sm.tokens) {
      // The secret copy wins unless the public one is shown (revealed elsewhere): a hidden copy in the public
      // record is a leak or a player's stub, never newer data.
      m.tokens = m.tokens || {};
      for (const [tid, t] of Object.entries(sm.tokens)) {
        if (!m.tokens[tid] || isHiddenToken(m.tokens[tid])) m.tokens[tid] = clone(t);
      }
    }
    if (sm.triggers) m.triggers = [...clone(sm.triggers), ...(m.triggers || []).filter(t => !sm.triggers.some(s => s.id === t.id))];
    if (sm.pins) {
      const have = new Set((m.pins || []).map(p => p.id));
      m.pins = [...(m.pins || []), ...clone(sm.pins).filter(p => !have.has(p.id))];
    }
  }
  return out;
}

/**
 * What a live event may carry to every screen: the payload, a reduced copy, or null (do not send it).
 * `ctx.isHidden(tokenId)` says whether a token is hidden on the sender's map.
 */
export function publicPayload(event, payload, ctx = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  switch (event) {
    case 'tokens:spawn':
      if (!Array.isArray(payload.tokens) || !payload.tokens.some(isHiddenToken)) return payload;
      return { ...payload, tokens: payload.tokens.map(t => (isHiddenToken(t) ? { id: t.id, visible: false } : t)) };
    case 'token:move':
      return ctx.isHidden?.(payload.tokenId) ? null : payload;
    case 'pins:update':
      if (!Array.isArray(payload.pins)) return payload;
      return { ...payload, pins: payload.pins.filter(isSharedPin) };
    case 'trigger:pending': {
      // The DM's screen finds the trap by id; nobody else needs its name or its square.
      const { label, cx, cy, ...rest } = payload;
      return rest;
    }
    default:
      return payload;
  }
}

// ── Receiving a trimmed event ─────────────────────────────────────────────────────────────────────────────────
// 🔴 The node echoes every event back to its sender, and a DM may have a second screen open. Applying the trimmed
// copy there as it stands would replace a real hidden monster with its `{ id, visible: false }` stub (and the next
// save would write the stub), or drop the DM-only pins.

const isStub = t => !!t && t.visible === false && Object.keys(t).every(k => k === 'id' || k === 'visible');

/**
 * The token to store when `incoming` arrives in a token spawn and this map holds `existing`; undefined = remove it.
 * On the DM's screen (its own echo, a second screen) a stub hides the token and keeps its data. A stub is never
 * stored on its own: other code reads a token's position and name.
 */
export function receivedToken(existing, incoming, isDM) {
  if (!isStub(incoming)) return incoming;
  // A player's screen drops it: keeping the data marked hidden, its next save would write it back to the public
  // record (a three-way merge keeps a local edit over a remote delete).
  return isDM && existing ? { ...existing, visible: false } : undefined;
}

/** A player's copy of a campaign without the hidden-token stubs it received; they are not data to save. */
export function withoutStubs(camp) {
  if (!camp?.maps) return camp;
  const out = clone(camp);
  for (const m of Object.values(out.maps)) {
    for (const [tid, t] of Object.entries(m?.tokens || {})) if (isStub(t)) delete m.tokens[tid];
  }
  return out;
}

/** The pins to keep when a pins update arrives: the DM's screen keeps its DM-only pins, which never travel. */
export function receivedPins(mine, incoming, isDM) {
  const pins = Array.isArray(incoming) ? incoming : [];
  if (!isDM) return pins;
  const have = new Set(pins.map(p => p.id));
  return [...pins, ...(mine || []).filter(p => !isSharedPin(p) && !have.has(p.id))];
}
