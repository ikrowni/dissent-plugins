import { h, clear } from '../core/dom.js';
export async function mountBuilder(root) { clear(root).append(h('p', { class: 'empty' }, 'Builder')); return { destroy() {} }; }
