// plugins/dnd-campaign-pick.js — which campaign a sidebar shows. Shared by dnd-player and
// dnd-master so both answer the same way.
const inIt = (c, uid) => (c.members || []).includes(uid) || c.dmUserId === uid;
export function pickCampaign(campaigns, storedId, userId) {
  const list = Object.values(campaigns || {});
  return (storedId && list.find(c => c.id === storedId && inIt(c, userId)))
    || list.find(c => inIt(c, userId)) || null;
}
