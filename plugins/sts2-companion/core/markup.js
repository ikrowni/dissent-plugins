// core/markup.js — Slay the Spire 2 text markup → DOM.
//
// Spire Codex resolves the game's {Var:diff()} templates; what remains is BBCode-like colour
// tags: [gold] (a game term — linked), [blue] [red] [green] (numbers and emphasis), and
// animation tags such as [sine] (dropped, text kept). Anything else between the tags is TEXT.
// 🔴 Never parsed as HTML: see core/dom.js.

import { h } from './dom.js';

const TAG = /\[(\/?)([a-z]+)(?:=[^\]]*)?\]/g;
const COLOURS = new Set(['blue', 'red', 'green', 'purple', 'orange', 'pink', 'aqua']);
// A capitalised bracket is an unresolved amount ("for [Amount] turns"), never a tag — tags are
// lowercase. Powers scale with a stack count, so there is no number to put there.
const PLACEHOLDER = /\[[A-Z][A-Za-z]*\]/g;

export function renderGameText(raw) {
  const src = String(raw ?? '').replace(PLACEHOLDER, 'X');
  const root = h('span', { class: 'game-text' });
  const stack = [root];
  let last = 0;

  const pushText = (s) => {
    const parts = s.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) stack[stack.length - 1].appendChild(h('br'));
      if (p) stack[stack.length - 1].appendChild(document.createTextNode(p));
    });
  };

  for (const m of src.matchAll(TAG)) {
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [, closing, name] = m;
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].dataset.tag === name) {
        const done = stack.pop();
        if (name === 'gold') done.dataset.term = done.textContent;
      }
      continue;
    }
    if (name === 'gold') {
      const el = h('button', { type: 'button', class: 'term', dataset: { tag: 'gold' } });
      stack[stack.length - 1].appendChild(el);
      stack.push(el);
    } else if (COLOURS.has(name)) {
      const el = h('span', { class: `t-${name}`, dataset: { tag: name } });
      stack[stack.length - 1].appendChild(el);
      stack.push(el);
    } else {
      // Unknown or animation tag: a transparent span so its closing tag still pairs.
      const el = h('span', { dataset: { tag: name } });
      stack[stack.length - 1].appendChild(el);
      stack.push(el);
    }
  }
  pushText(src.slice(last));
  return root;
}
