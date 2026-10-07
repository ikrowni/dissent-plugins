// book-cut-actions.js — what a box cut from a page (book-cut.js) can become (plan 2026-10-06 page reader, owner's
// choices): the table's map, a picture popped up on the players' screens, a page of the party journal (sharing a
// read-aloud box or a handout), or a map or art kept in the book's Maps & art for later.
// The players only ever get a campaign copy of the picture: the book file stays the DM's alone.
import { requestWithTransfer } from '../../plugin-sdk.js';
import { realtimePublish } from '../dnd-hub-publish.js';
import { serverData, userId } from '../dnd-hub-state.js?v=20261015b';
import { saveHubDm } from '../dnd-hub-storage.js?v=20261015b';
import { EV } from '../dnd-hub-event-types.js?v=20261015b';
import { addMapFromBuffer } from '../dnd-hub-map-bg.js?v=20261015b';
import { showHandoutOverlay } from '../dnd-hub-pins.js?v=20261015b';
import { guarded } from '../lk-upload.js';
import { listBooks, saveBookImage, resaveBook, deleteFiles } from './book-library.js';

const where = cut => `page ${cut.page}`;

/** A campaign copy of the cut picture (players can read it; the book they cannot). Returns its file id. */
async function campaignCopy(camp, cut, name) {
  const data = await cut.blob.arrayBuffer();
  const res = await guarded(requestWithTransfer)('files:upload', { data, name: `${name}.webp`, mime: 'image/webp',
    attachContext: `campaign:${camp.id}` }, [data], 120000);
  return res.id;
}

/**
 * The actions for the box tool. `ctx`: { book, camp, entry (the index line being read, or null), close() (the panel
 * is done), redraw() }.
 */
export function cutActions(ctx) {
  const { book, camp } = ctx;
  const label = cut => `${book.title}, ${ctx.entry?.title ? `${ctx.entry.title}, ` : ''}${where(cut)}`;
  return [
    { label: 'Use as the map', primary: true, run: async cut => {
      if (!confirm('Make this the map for everyone? The current map stays in your maps.')) return false;
      await addMapFromBuffer(await cut.blob.arrayBuffer(), `${book.title} - ${where(cut)}`, 'image/webp');
      ctx.close();
      return true;
    } },
    { label: 'Show the players', run: async cut => {
      const title = label(cut);
      const imageFileId = await campaignCopy(camp, cut, title);
      await realtimePublish(EV.HANDOUT_PUSH, { type: EV.HANDOUT_PUSH, campaignId: camp.id, title, content: '', imageFileId, fromUserId: userId });
      showHandoutOverlay({ title, content: '', imageFileId });
      return true;
    } },
    { label: 'Share in the journal', run: async cut => {
      const title = prompt('A title for the party journal:', ctx.entry?.title || `${book.title}, ${where(cut)}`)?.trim();
      if (!title) return false;
      const imageFileId = await campaignCopy(camp, cut, title);
      const id = `cut-${book.id}-${Date.now().toString(36)}`.slice(0, 120);
      const now = new Date().toISOString();
      camp.journals = { ...(camp.journals || {}), [id]: { id, title: title.slice(0, 120), content: '', imageFileId, visibility: 'player',
        createdAt: now, updatedAt: now, source: { book: book.id, doc: cut.doc, page: cut.page, section: ctx.entry?.id || null } } };
      await saveHubDm(serverData);
      await realtimePublish(EV.HANDOUT_PUSH, { type: EV.HANDOUT_PUSH, campaignId: camp.id, journalId: id, title, content: '', imageFileId, fromUserId: userId });
      showHandoutOverlay({ title, content: '', imageFileId });
      ctx.redraw();
      return true;
    } },
    { label: 'Keep as a map', run: cut => keep(ctx, cut, 'map') },
    { label: 'Keep as art', run: cut => keep(ctx, cut, 'art') },
  ];
}

/**
 * Keep the cut in the book's Maps & art: the picture saved beside the book (where the book is), the book saved again
 * listing it (the node cannot overwrite a file: book-library.js resaveBook), and the DM's campaigns pointed at the new
 * file. A failure leaves the book as it was.
 */
async function keep(ctx, cut, kind) {
  const { book, camp } = ctx;
  const title = prompt(kind === 'map' ? 'A name for this map:' : 'A name for this picture:', ctx.entry?.title || `Page ${cut.page}`)?.trim();
  if (!title) return false;
  const oldFileId = camp.bookFiles?.[book.id];
  if (!oldFileId) throw new Error('this campaign does not hold the book file');
  const place = (await listBooks()).books.find(b => b.fileId === oldFileId)?.place || 'server';
  const pic = { id: `cut-${Date.now().toString(36)}`, title: title.slice(0, 80), kind, doc: cut.doc, page: cut.page,
    rect: cut.rect.map(v => +v.toFixed(5)), width: cut.width, height: cut.height, source: 'cut' };
  const fileId = await saveBookImage(book, { id: pic.id, blob: cut.blob }, place);
  book.images = [...(book.images || []), { ...pic, fileId }];
  let newId;
  try { newId = await resaveBook(oldFileId, book); } catch (e) {
    book.images = book.images.filter(i => i.id !== pic.id); // the book file is unchanged: drop the picture again
    deleteFiles([fileId]);
    throw e;
  }
  // The book is saved. A campaign not pointed at the new file yet finds it by the book's id (campaignBooks).
  for (const c of Object.values(serverData?.campaigns || {})) if (c.bookFiles?.[book.id] === oldFileId) c.bookFiles = { ...c.bookFiles, [book.id]: newId };
  await saveHubDm(serverData).catch(() => {});
  ctx.redraw();
  return true;
}
