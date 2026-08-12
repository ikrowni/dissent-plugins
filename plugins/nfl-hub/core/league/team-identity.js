// core/league/team-identity.js — what a team may be called, and what an image
// reference may be. Pure, and shared by both halves of the plugin.
//
// ⚠️ IT LIVES HERE FOR THE REASON EVERY OTHER core/league MODULE DOES: the module
// re-checks every rule because the browser cannot be trusted, and the browser
// needs the same rule to avoid offering an action that will be refused. Two
// copies of "is this name allowed" is how the client starts disagreeing with the
// server about what a legal name is — the same argument `scoring.js` makes about
// what "PPR" means.
//
// ⚠️ NOTHING HERE THROWS. `server/ops-identity.js` turns a refusal into an Error
// because that is how an op reports one; the browser turns the same refusal into
// a message beside a form. A shared module that threw would force the client into
// a try/catch to validate a keystroke.

/** The longest a franchise name may be. The form's `maxlength` mirrors this. */
export const MAX_TEAM_NAME = 60;

/**
 * The shape `plugin_files.id` takes: a v4 UUID minted by the node
 * (`uuid.New().String()`, internal/api/handlers/plugin_files.go).
 *
 * ⚠️ A SHAPE CHECK, NOT AN AUTHORISATION. It exists so a team record can never
 * hold something renderable as a URL. Whether the viewer may READ that file is
 * decided by the node when the client redeems the id, against server membership —
 * an authorisation neither this module nor the WASM module could perform.
 */
export const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A team name as it will be stored and compared.
 *
 * ⚠️ INTERNAL RUNS OF WHITESPACE COLLAPSE. Without it "The  Commish" and "The
 * Commish" are two different names to the duplicate check and one identical name
 * to every human reading the standings — exactly the confusion the duplicate rule
 * exists to prevent.
 */
export function normalizeTeamName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** The key two names are compared on. Case-insensitive, deliberately. */
export function nameKey(name) {
  return normalizeTeamName(name).toLowerCase();
}

/**
 * The id of a team OTHER than `exceptTeamId` already using this name, or null.
 *
 * ⚠️ `exceptTeamId` is what makes a re-CASE possible: renaming "the commish" to
 * "The Commish" must not clash with itself.
 */
export function nameTaken(teams, name, exceptTeamId = null) {
  const want = nameKey(name);
  if (!want) return null;
  for (const [id, team] of Object.entries(teams ?? {})) {
    if (String(id) === String(exceptTeamId)) continue;
    if (nameKey(team?.name) === want) return String(id);
  }
  return null;
}

/**
 * Validate a name for storage.
 *
 * ⚠️ REFUSED, NOT TRUNCATED, when too long. Silently storing the first 60
 * characters of somebody's franchise name and showing it back to them is worse
 * than saying no — they cannot tell it happened.
 */
export function checkTeamName(raw) {
  const name = normalizeTeamName(raw);
  if (!name) return { ok: false, error: 'a team name cannot be empty' };
  if (name.length > MAX_TEAM_NAME) {
    return {
      ok: false,
      error: `a team name is at most ${MAX_TEAM_NAME} characters (that one is ${name.length})`,
    };
  }
  return { ok: true, name };
}

/**
 * Validate an image reference.
 *
 * ⚠️ "" CLEARS, and that is not the same as absent. A field the payload omits is
 * left alone; a field set to "" removes the image. Without the distinction there
 * is no way to drop an avatar without also dropping the banner.
 */
export function checkFileId(value, label = 'image') {
  const v = String(value ?? '').trim();
  if (v === '') return { ok: true, fileId: '' };
  if (!FILE_ID_RE.test(v)) {
    return {
      ok: false,
      error: `${label} must be a file id from an upload to this server, not "${v.slice(0, 60)}"`,
    };
  }
  return { ok: true, fileId: v.toLowerCase() };
}
