// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/dnd-campaign-pick.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../dnd-campaign-pick.js' directly would make the plugin unmirrorable.

// plugins/dnd-campaign-pick.js — which campaign a sidebar shows. Shared by dnd-player and
// dnd-master so both answer the same way.
const inIt = (c, uid) => (c.members || []).includes(uid) || c.dmUserId === uid;
export function pickCampaign(campaigns, storedId, userId) {
  const list = Object.values(campaigns || {});
  return (storedId && list.find(c => c.id === storedId && inIt(c, userId)))
    || list.find(c => inIt(c, userId)) || null;
}
