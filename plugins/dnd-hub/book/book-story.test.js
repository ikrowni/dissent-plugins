// plugins/dnd-hub/book/book-story.test.js
import { describe, it, expect } from 'vitest';
import { findStory } from './book-story.js';
import { STORY } from './book-fixtures.js';

describe('findStory', () => {
  const s = findStory(STORY);
  it('splits chapters into sections by heading size; smaller headings stay inside', () => {
    expect(s.map(x => [x.chapter, x.title])).toEqual([
      ['Chapter 1: The Drowned Bell', 'Chapter 1: The Drowned Bell'],
      ['Chapter 1: The Drowned Bell', 'Arriving in Brinemoor'],
      ['Chapter 2: Under the Waves', 'Chapter 2: Under the Waves'],
    ]);
    expect(s[1].html).toContain('<h4>The Harbour Master</h4>');
  });
  it('keeps paragraphs: an indented line starts a new one', () => {
    expect(s[0].html).toBe('<p>The village of Brinemoor has not heard its bell in a hundred years.</p><p>Last night, it rang.</p>');
  });
  it('marks boxed read-aloud text (a run of lines in their own font) and lists it', () => {
    expect(s[1].readAloud).toEqual(['Fog rolls off the water. Somewhere below the waves, a bell tolls once.']);
    expect(s[1].html).toContain('<blockquote class="read-aloud">Fog rolls off the water.');
  });
  it('escapes text', () => {
    const [x] = findStory([H2('Notes'), { ...STORY[1], text: 'a <b> & c', runs: [{ text: 'a <b> & c', font: 'body' }] }]);
    expect(x.html).toBe('<p>a &lt;b&gt; &amp; c</p>');
  });
  it('ids are unique and stable', () => {
    expect(new Set(s.map(x => x.id)).size).toBe(3);
    expect(findStory(STORY)[1].id).toBe(s[1].id);
  });
});
function H2(t) { return { ...STORY[0], text: t, runs: [{ text: t, font: 'bold' }] }; }

describe('a scan', () => {
  it('never guesses read-aloud boxes from fonts (a scan\'s fonts are the OCR\'s guesses)', () => {
    // Curse of Strahd, scanned: ordinary text came out boxed because the text layer's fonts change line to line.
    const s = findStory(STORY, { scanned: true });
    expect(s.flatMap(x => x.readAloud)).toEqual([]);
    expect(s.map(x => x.html).join('')).not.toContain('read-aloud');
  });
});

describe('body text set in two fonts', () => {
  it('a line wholly in the body\'s second font is not a read-aloud box (Heliana alternates two body fonts)', () => {
    const P = (t, font) => ({ text: t, size: 9.8, runs: [{ text: t, font }], page: 1, x: 57, y: 0 });
    const mixed = t => ({ text: t + ' more', size: 9.8, runs: [{ text: t, font: 'f6' }, { text: 'more', font: 'f7' }], page: 1, x: 57, y: 0 });
    const lines = [H2('Hunting'), P('one line in the main font', 'f6'), mixed('a line in both'), P('a whole line in the second font, long enough to be a box of read-aloud text', 'f7'),
      P('back in the main font', 'f6'), mixed('both again'), P('main', 'f6'), P('main again', 'f6')];
    const [s] = findStory(lines);
    expect(s.readAloud).toEqual([]);
  });
});
