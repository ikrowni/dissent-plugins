// core/app.js — bootstrap: data, art, the section frame and the credits footer.

import { connect } from './host.js';
import { createData } from './data.js';
import { createPackReader } from './pack.js';
import { h, clear } from './dom.js';

const view = document.getElementById('view');
const credits = document.getElementById('credits');

export const ctx = {
  data: createData(),
  art: null,
  placement: 'page',
  contextType: null,
};

async function boot() {
  const index = await fetch('art/index.json').then((r) => r.json());
  ctx.art = createPackReader({ index });

  const meta = await ctx.data.meta();
  clear(credits).append(
    'Data: ', h('a', { href: meta.source, target: '_blank', rel: 'noopener' }, 'Spire Codex'),
    ' · ', h('a', { href: meta.game, target: '_blank', rel: 'noopener' }, meta.copyright),
    ` · game build ${meta.gameVersion}`,
  );

  const { mountWiki } = await import('../views/wiki.js');
  mountWiki(view, ctx);
}

connect({
  onInit(msg) {
    ctx.placement = msg.context?.placement ?? 'page';
    ctx.contextType = msg.context?.contextType ?? null;
  },
});

boot().catch((e) => {
  console.error('[sts2-companion] boot failed', e);
  clear(view).append(h('p', { class: 'empty' }, 'STS2 Companion could not load its data.'));
});
