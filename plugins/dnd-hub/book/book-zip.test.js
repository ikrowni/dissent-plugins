// plugins/dnd-hub/book/book-zip.test.js — zips written here: stored, deflated, ZIP64, a trailing comment.
import { describe, it, expect } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { listZip, entryBlob } from './book-zip.js';
import { planBundle, bundleTitle, mergeParsed, niceName } from './book-bundle.js';

function zip(files, { zip64 = false, comment = '' } = {}) {
  const parts = [], cd = [];
  let off = 0;
  for (const [name, text, method] of files) {
    const data = Buffer.from(text), body = method === 8 ? deflateRawSync(data) : data, nm = Buffer.from(name);
    const crc = crc32(data);
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(data.length), 4); extra.writeBigUInt64LE(BigInt(body.length), 12); }
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(zip64 ? 0xffffffff : body.length, 18); lh.writeUInt32LE(zip64 ? 0xffffffff : data.length, 22);
    lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(extra.length, 28);
    parts.push(lh, nm, extra, body);
    const cextra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) { cextra.writeUInt16LE(1, 0); cextra.writeUInt16LE(24, 2); cextra.writeBigUInt64LE(BigInt(data.length), 4); cextra.writeBigUInt64LE(BigInt(body.length), 12); cextra.writeBigUInt64LE(BigInt(off), 20); }
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20); ch.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt16LE(cextra.length, 30); ch.writeUInt32LE(zip64 ? 0xffffffff : off, 42);
    cd.push(ch, nm, cextra);
    off += lh.length + nm.length + extra.length + body.length;
  }
  const cdBuf = Buffer.concat(cd), tail = [];
  if (zip64) {
    const r = Buffer.alloc(56); r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4);
    r.writeBigUInt64LE(BigInt(files.length), 24); r.writeBigUInt64LE(BigInt(files.length), 32);
    r.writeBigUInt64LE(BigInt(cdBuf.length), 40); r.writeBigUInt64LE(BigInt(off), 48);
    const l = Buffer.alloc(20); l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cdBuf.length), 8); l.writeUInt32LE(1, 16);
    tail.push(r, l);
  }
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(zip64 ? 0xffff : files.length, 8); e.writeUInt16LE(zip64 ? 0xffff : files.length, 10);
  e.writeUInt32LE(zip64 ? 0xffffffff : cdBuf.length, 12); e.writeUInt32LE(zip64 ? 0xffffffff : off, 16); e.writeUInt16LE(comment.length, 20);
  return new Blob([...parts, cdBuf, ...tail, e, Buffer.from(comment)]);
}

describe('book-zip', () => {
  const files = [['Bundle/Book.pdf', '%PDF pretend book', 8], ['Bundle/Deck/Card 1.png', 'png-bytes', 0], ['Bundle/', '', 0]];
  for (const [label, opts] of [['a plain zip', {}], ['ZIP64 with a comment', { zip64: true, comment: 'made by a tool' }]]) {
    it(`lists and unpacks ${label}, leaving folders out`, async () => {
      const z = zip(files, opts);
      const list = await listZip(z);
      expect(list.map(e => [e.name, e.method, e.size])).toEqual([['Bundle/Book.pdf', 8, 17], ['Bundle/Deck/Card 1.png', 0, 9]]);
      expect(await (await entryBlob(z, list[0])).text()).toBe('%PDF pretend book');
      expect(await (await entryBlob(z, list[1], 'image/png')).text()).toBe('png-bytes');
    });
  }
  it('says so for a file that is not a zip, and for a password-protected entry', async () => {
    await expect(listZip(new Blob(['not a zip at all']))).rejects.toThrow(/not a zip/);
    await expect(entryBlob(new Blob([]), { name: 'x.pdf', encrypted: true })).rejects.toThrow(/password/);
  });
});

describe('book-bundle', () => {
  it('sorts a bundle: PDFs smallest first, images grouped by folder, packs, junk dropped, the rest left out', () => {
    const plan = planBundle([
      { path: 'Adv/Maps.pdf', size: 900 }, { path: 'Adv/Book.pdf', size: 40 }, { path: 'Adv/Oracle Deck/Card 10.png', size: 1 },
      { path: 'Adv/Oracle Deck/Card 2.png', size: 1 }, { path: 'Adv/cover.jpg', size: 1 }, { path: 'Adv/README.txt', size: 1 },
      { path: '__MACOSX/Adv/._Book.pdf', size: 1 }, { path: 'Adv/Thumbs.db', size: 1 }, { path: 'Adv\\old.lkpack', size: 1 }]);
    expect(plan.pdfs.map(p => p.path)).toEqual(['Adv/Book.pdf', 'Adv/Maps.pdf']);
    expect(plan.images.map(i => [i.group, i.name])).toEqual([['Adv', 'cover'], ['Oracle Deck', 'Card 2'], ['Oracle Deck', 'Card 10']]);
    expect(plan.packs.length).toBe(1);
    expect(plan.skipped.map(s => s.path)).toEqual(['Adv/README.txt']);
    expect(bundleTitle('Mud_Manor-Bundle.zip', plan)).toBe('Mud Manor Bundle');
    expect(niceName('Deck/Broken_One.png')).toBe('Broken One');
  });
  it('merges several PDFs into one book with unique ids; each find says which PDF it is from', () => {
    const a = { monsters: [{ id: 'goblin' }, { id: 'goblin-2' }], story: [{ id: 'intro', chapter: 'One' }] };
    const b = { monsters: [{ id: 'goblin' }], story: [{ id: 'intro', chapter: 'Maps' }], images: [{ id: 'p1-1' }] };
    const m = mergeParsed([{ parsed: a, source: 'Book' }, { parsed: b, source: 'Maps Pack' }]);
    expect(m.monsters.map(x => [x.id, x.doc])).toEqual([['goblin', 0], ['goblin-2', 0], ['goblin-3', 1]]);
    // The reader's PDF switcher names the file: chapter names stay the book's own.
    expect(m.story.map(x => [x.id, x.chapter, x.doc])).toEqual([['intro', 'One', 0], ['intro-2', 'Maps', 1]]);
    expect(m.images.map(x => x.doc)).toEqual([1]);
  });
});

describe('a Word file in a bundle', () => {
  it('is read as a book of its own (book-docx.js), not left out', () => {
    const plan = planBundle([{ path: 'Arcane Ascension Monster Manual.docx', size: 39e6 }, { path: 'notes.txt', size: 1 }]);
    expect(plan.docs.map(d => d.path)).toEqual(['Arcane Ascension Monster Manual.docx']);
    expect(plan.skipped.map(d => d.path)).toEqual(['notes.txt']);
    expect(bundleTitle('Arcane Ascension Monster Manual.docx', plan)).toBe('Arcane Ascension Monster Manual');
  });
});

