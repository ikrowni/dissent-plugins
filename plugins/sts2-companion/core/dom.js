// core/dom.js — build elements without HTML strings.
//
// 🔴 This plugin renders third-party game text. There is no innerHTML anywhere in it, and a
// test scans for one. Build nodes with h() and text with strings only.

/**
 * h('div', { class: 'x', onclick: fn, dataset: { id: '1' } }, 'text', childNode, [more])
 * Attribute values are set with setAttribute; children strings become text nodes.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
