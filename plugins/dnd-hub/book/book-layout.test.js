// plugins/dnd-hub/book/book-layout.test.js — hand-written pdf.js-shaped items, never text from a real book.
import { describe, it, expect } from 'vitest';
import { pageLines } from './book-layout.js';

const it_ = (x, y, str, h = 9.8, font = 'body') => ({ str, transform: [h, 0, 0, h, x, y], height: h, fontName: font });
const page = (items, w = 612, h = 792) => ({ items, width: w, height: h });

describe('pageLines', () => {
  it('text drawn twice in the same place (an outlined heading) is read once', () => {
    // Heliana's Guide draws every heading twice at one spot: "CreditsCredits", "TheThe Loot TavernLoot Tavern".
    const lines = pageLines(page([it_(57, 700, 'Credits', 24), it_(57, 700, 'Credits', 24), it_(57, 650, 'Lead Writer:'),
      it_(120, 650, 'Max'), it_(57.2, 650.1, 'Lead Writer:')]));
    expect(lines.map(l => l.text)).toEqual(['Credits', 'Lead Writer: Max']);
  });
  it('the same word twice on a line, apart, is kept', () => {
    const [l] = pageLines(page([it_(57, 700, 'very'), it_(90, 700, 'very')]));
    expect(l.text).toBe('very very');
  });
  it('reads the left column top to bottom, then the right', () => {
    const lines = pageLines(page([
      it_(328, 700, 'right one'), it_(57, 700, 'left one'), it_(57, 688, 'left two'), it_(328, 688, 'right two'),
    ]), 3);
    expect(lines.map(l => l.text)).toEqual(['left one', 'left two', 'right one', 'right two']);
    expect(lines[0].page).toBe(3);
  });
  it('joins the runs of one line, keeping each run\'s font', () => {
    const [l] = pageLines(page([it_(57, 600, 'Nimble Escape.', 9.8, 'bi'), it_(140, 600, 'The goblin can take', 9.8, 'body')]));
    expect(l.text).toBe('Nimble Escape. The goblin can take');
    expect(l.runs).toEqual([{ text: 'Nimble Escape.', font: 'bi' }, { text: 'The goblin can take', font: 'body' }]);
  });
  it('drops running headers, footers and bare page numbers', () => {
    const lines = pageLines(page([it_(380, 770, 'A Book of Things 5.1'), it_(560, 770, '214'), it_(57, 700, 'Text'), it_(300, 20, '214')]));
    expect(lines.map(l => l.text)).toEqual(['Text']);
  });
  it('a line\'s size is its tallest run; empty runs are ignored', () => {
    const [l] = pageLines(page([it_(57, 500, '', 0), it_(57, 500, 'Goblin', 12, 'bold')]));
    expect(l).toMatchObject({ text: 'Goblin', size: 12 });
  });
  it('a single-column page (text across the middle) stays in plain top-to-bottom order', () => {
    const lines = pageLines(page([it_(57, 700, 'A heading that runs across the whole page width of the book'), it_(57, 680, 'next')]));
    expect(lines.map(l => l.text)).toEqual(['A heading that runs across the whole page width of the book', 'next']);
  });
  it('a hyphen at a line end is kept as text (the joiner decides later)', () => {
    const [l] = pageLines(page([it_(57, 700, 'some-')]));
    expect(l.text).toBe('some-');
  });
});

describe('a line knows how wide it is', () => {
  it('w runs from the first item to the end of the last', () => {
    // it_ gives no width, so pdf.js-like width falls back to str.length × h × 0.5: 'abcd' at h 10 → 20 points.
    const [l] = pageLines(page([it_(57, 700, 'ab', 10), it_(80, 700, 'abcd', 10)]));
    expect(l.x).toBe(57);
    expect(l.w).toBe(43); // 80 + 20 − 57
  });
});

// Heliana's wide stat blocks (owner report 2026-10-06): the right column starts at x 295 on a 595-point page, just LEFT
// of the middle (297.5), so splitting at the middle glued right-column words onto left-column lines: "Tar-rasque
// Actions", "27 (+8) … 10 (+0) creature, it must succe…". The split is where the right column really starts.
describe('a right column that starts just left of the middle', () => {
  const W = 595;
  const right = (y, str) => it_(295, y, str, 9.5);
  const items = [
    it_(40, 718, 'Tar-rasque', 16), right(718, 'Actions'),
    it_(40, 704, 'Gargantuan elemental (titan), unaligned', 9.5), right(704, 'Multiattack.'),
    it_(39, 688, 'Armour Class 18', 10), right(691, 'Necrotar Tongue, two with its Claws'),
    it_(40, 632, '27 (+8) 15 (+2) 28 (+9)', 11), right(632, 'creature, it must succeed'),
    right(620, 'or be grappled'), right(609, 'maw. Until this grapple ends'), right(597, 'the target is restrained'),
  ];
  const lines = pageLines(page(items, W, 782));
  it('the right column\'s words stay in the right column', () => {
    expect(lines.map(l => l.text)).toEqual(['Tar-rasque', 'Gargantuan elemental (titan), unaligned', 'Armour Class 18',
      '27 (+8) 15 (+2) 28 (+9)', 'Actions', 'Multiattack.', 'Necrotar Tongue, two with its Claws', 'creature, it must succeed',
      'or be grappled', 'maw. Until this grapple ends', 'the target is restrained']);
  });
  it('a page with nothing starting near the middle still splits at the middle', () => {
    const ls = pageLines(page([it_(57, 700, 'left'), it_(320, 700, 'right')], 612));
    expect(ls.map(l => l.text)).toEqual(['left', 'right']);
  });
});
