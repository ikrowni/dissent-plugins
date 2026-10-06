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
