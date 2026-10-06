// plugins/dnd-hub/book/book-ocr-lines.test.js
import { describe, it, expect } from 'vitest';
import { pagesToRead, tsvToLines, replacePages, WORD_EM } from './book-ocr-lines.js';

const L = (text, page) => ({ text, page, size: 8.4, runs: [{ text, font: 'ocr' }], x: 30, y: 0 });
// Tesseract TSV: level page block par line word left top width height conf text
const W = (block, par, line, word, left, top, h, text, conf = 90) => [5, 1, block, par, line, word, left, top, 40, h, conf, text].join('\t');

describe('reading scanned pages again', () => {
  it('reads the pages with stat-block signs (misread loosely) and the page after each', () => {
    const lines = [L('story', 1), L('Armor C1ass 15', 4), L('Hit Poınts 22 (5d8)', 6), L('a challenge 1 of them', 8),
      L('His Armor Class is 17', 9), L('STR DEX CON INT WIS CHA', 10)];
    expect(pagesToRead(lines, 10)).toEqual([4, 5, 6, 7, 10]);
  });
  it('groups words into lines in Tesseract’s order (columns read whole), in points, with sizes from word height', () => {
    const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      W(1, 1, 1, 1, 60, 100, 30, 'RAHADIN'),
      W(1, 2, 1, 1, 60, 140, 17, 'Armor'), W(1, 2, 1, 2, 120, 140, 17, 'Class'), W(1, 2, 1, 3, 180, 140, 17, '18'),
      W(2, 1, 1, 1, 560, 100, 17, 'Multiattack.'), W(2, 1, 1, 2, 700, 100, 17, 'Rahadin'),
      W(2, 1, 1, 3, 800, 100, 17, '', -1)].join('\n');
    const out = tsvToLines(tsv, 7, 2);
    expect(out.map(l => l.text)).toEqual(['RAHADIN', 'Armor Class 18', 'Multiattack. Rahadin']);
    expect(out.map(l => l.x)).toEqual([30, 30, 280]);
    expect(out[0].size).toBeCloseTo(30 / 2 / WORD_EM, 1);
    expect(out[1].size).toBeLessThan(out[0].size);
    expect(out.every(l => l.page === 7 && l.runs[0].font === 'ocr')).toBe(true);
  });
  it('puts the pages read again where the old ones were', () => {
    const lines = [L('a', 1), L('b', 2), L('c', 2), L('d', 3)];
    const out = replacePages(lines, new Map([[2, [L('B', 2)]]]));
    expect(out.map(l => l.text)).toEqual(['a', 'B', 'd']);
  });
});

describe('black and white before OCR', () => {
  it('keeps dark ink black and turns parchment white', async () => {
    const { blackAndWhite } = await import('./book-ocr-lines.js');
    const px = new Uint8ClampedArray([20, 20, 20, 255, 230, 215, 180, 255, 90, 60, 40, 128]);
    expect([...blackAndWhite(px)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  });
});

describe('OCR lines are measured from the top', () => {
  it('carry fromTop and their width', () => {
    // level 5 = word: level page block par line word left top width height conf text
    const tsv = ['5\t1\t1\t1\t1\t1\t100\t200\t50\t20\t96\tHello', '5\t1\t1\t1\t1\t2\t160\t200\t40\t20\t96\tthere'].join('\n');
    const [l] = tsvToLines(tsv, 3, 2);
    expect(l).toMatchObject({ page: 3, x: 50, y: 100, w: 50, fromTop: true }); // (160 + 40 − 100) / 2
  });
});
