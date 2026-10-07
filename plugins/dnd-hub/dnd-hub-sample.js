// dnd-hub-sample.js — "Start the sample adventure": a normal, editable campaign built from a content pack
// (spec 2026-10-03 §3).
import { serverData, setServerData } from './dnd-hub-state.js?v=20261015b';
import { getIdentity, genId } from '../plugin-sdk.js';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015b';
import { campaignRecord } from './dnd-hub-rules.js';
import { compileMap, validatePack } from './lk-content-pack.js';
import { packFileId } from './dnd-hub-pack-map.js';
import { enterCampaignAsDM } from './dnd-hub-screens.js?v=20261015b';

const html = parts => (parts || []).map(p => p).join('\n\n');

export async function startSampleAdventure() {
  const btn = document.getElementById('btn-sample-adventure');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting the table…'; }
  try {
    const pack = await (await fetch(new URL('./packs/lanternkeep-sample.json', document.baseURI).href)).json();
    const problems = validatePack(pack);
    if (problems.length) throw new Error(problems.join('; '));
    const identity = await getIdentity();
    if (!identity?.id) throw new Error('Could not verify identity.');

    const id = genId();
    const camp = campaignRecord({ id, name: pack.meta.name, description: pack.meta.description,
      dmUserId: identity.id, dmDisplayName: identity.displayName || 'Unknown DM' });

    // Map: drawn on every screen from the pack, never uploaded, so Quick start needs no storage (plan 2026-10-03).
    const pm = pack.maps[0];
    const mapId = genId();
    camp.maps[mapId] = { id: mapId, fileId: packFileId('lanternkeep-sample', pm.id), name: pm.name, mime: 'image/png', ...compileMap(pm) };
    camp.activeMapId = mapId;

    // Story: one journal page per section; read-aloud first, DM notes after.
    const now = new Date().toISOString();
    for (const s of pack.story) {
      const jid = genId();
      const text = [html(s.readAloud), s.dmNotes ? `DM: ${s.dmNotes}` : ''].filter(Boolean).join('\n\n');
      camp.journals[jid] = { id: jid, title: s.title, content: text, visibility: s.visibility === 'player' ? 'player' : 'dm', createdAt: now };
    }
    // Items the DM can award.
    for (const it of pack.items) {
      const iid = genId();
      camp.items[iid] = { id: iid, name: it.name, type: it.type, description: it.description, effects: it.effects || [],
        effectsText: '', imageFileId: null };
    }
    // Prepared encounters, with the cells their monsters stand on.
    for (const e of pack.encounters) {
      camp.encounters[e.id] = { id: e.id, name: e.name, difficulty: e.difficulty, items: e.items, spawn: e.spawn };
    }
    // One scene for the map.
    for (const sc of pack.scenes) {
      const sid = genId();
      camp.scenes[sid] = { id: sid, name: sc.name, mapId, shopId: null, videoFileId: null, soundtrackFileId: null, ambientVolume: 0.5 };
    }

    if (!serverData) setServerData({ campaigns: {} });
    serverData.campaigns = serverData.campaigns || {};
    serverData.campaigns[id] = camp;
    await saveHubDm(serverData);
    await enterCampaignAsDM(id);
  } catch (e) {
    alert('Could not start the sample adventure: ' + (e?.message || e));
    if (btn) { btn.disabled = false; btn.textContent = 'Start the sample adventure'; }
  }
}
