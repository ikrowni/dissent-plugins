import { h } from '../core/dom.js';
export async function renderDetail(ref) { return h('div', { class: 'detail' }, ref.id); }
