import { describe, it, expect } from 'vitest';
import { cleanStage, addToStage, removeFromStage, speak, MAX_ON_STAGE } from './lk-stage.js';

const npc = (id, name = id.toUpperCase()) => ({ id, name, portraitFileId: null });

describe('the stage', () => {
  it('holds up to four NPCs, each once', () => {
    let s = null;
    for (const id of ['a', 'b', 'a', 'c', 'd', 'e']) s = addToStage(s, npc(id));
    expect(s.npcs.map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.npcs).toHaveLength(MAX_ON_STAGE);
  });
  it('the newest NPC speaks first', () => expect(addToStage(addToStage(null, npc('a')), npc('b')).speaker).toBe('b'));
  it('a line has a speaker on the stage, or none (the narrator)', () => {
    let s = addToStage(null, npc('a', 'Marta'));
    s = speak(s, 'a', '  Bones, stranger? ');
    expect(s.line).toMatchObject({ speaker: 'a', name: 'Marta', text: 'Bones, stranger?' });
    expect(speak(s, null, 'The fire crackles.').line).toMatchObject({ speaker: null, name: '', text: 'The fire crackles.' });
    expect(speak(s, 'zz', 'Who?').line.speaker).toBeNull();
    expect(speak(s, 'a', 'x'.repeat(900)).line.text).toHaveLength(500);
  });
  it('every line is new (a repeated line still shows again)', () => {
    const s = addToStage(null, npc('a'));
    expect(speak(s, 'a', 'Hi').line.n).not.toBe(speak(speak(s, 'a', 'Hi'), 'a', 'Hi').line.n);
  });
  it('taking the last NPC off ends the scene', () => {
    const s = addToStage(addToStage(null, npc('a')), npc('b'));
    expect(removeFromStage(s, 'b').speaker).toBe('a');
    expect(removeFromStage(removeFromStage(s, 'a'), 'b')).toBeNull();
  });
  it('cleans what comes over the network', () => {
    expect(cleanStage({ npcs: [{ id: 'a', name: 'x'.repeat(99) }, { name: 'no id' }], speaker: 'q', line: { text: 5 } }))
      .toEqual({ npcs: [{ id: 'a', name: 'x'.repeat(40), portraitFileId: null }], speaker: 'a', line: null });
    expect(cleanStage({ npcs: [] })).toBeNull();
  });
});
