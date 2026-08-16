// tournament/dialog.js — in-plugin modal dialogs, replacing window.prompt/confirm.
//
// The frame's sandbox DOES include allow-modals, so the native dialogs worked. They were
// replaced because parsing "2-1" out of free text has no live validation, cannot show the
// series rules, and looks nothing like the plugin.
//
// ⚠️ Mounted on document.body, never inside the tournament panel. A position:fixed element
// is positioned relative to the nearest ancestor with a transform/filter/perspective, not
// the viewport — so a modal rendered inside a transformed container lands in the wrong
// place, and the container's overflow can clip it outright.

import { validateScore } from './bracket.js';

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let _open = null;

function teardown() {
  if (!_open) return;
  document.removeEventListener('keydown', _open.onKey, true);
  _open.root.remove();
  _open = null;
}

/// Builds the shell and returns { root, body, resolve } wired for escape/backdrop dismissal.
function mount(onCancel) {
  teardown(); // only ever one dialog; a second would trap focus behind the first

  const root = document.createElement('div');
  root.className = 'rlt-modal-root';
  root.innerHTML = `<div class="rlt-modal-backdrop"></div><div class="rlt-modal" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(root);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  };
  // Capture phase: inputs inside the dialog stop propagation on keydown, and without
  // capture the escape handler would never fire while one is focused.
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.rlt-modal-backdrop').addEventListener('click', onCancel);

  _open = { root, onKey };
  return { root, body: root.querySelector('.rlt-modal') };
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => { teardown(); resolve(v); };
    const { body: el } = mount(() => done(false));

    el.innerHTML = `
      <div class="rlt-modal-title">${esc(title)}</div>
      <div class="rlt-modal-body">${esc(body)}</div>
      <div class="rlt-modal-actions">
        <button class="btn-sm" data-act="cancel">Cancel</button>
        <button class="btn-sm ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmLabel)}</button>
      </div>`;

    el.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
    el.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
    el.querySelector('[data-act="ok"]').focus();
  });
}

/// Resolves { s1, s2 } or null if cancelled. Cannot resolve an invalid score — the confirm
/// button stays disabled until validateScore accepts it.
export function scoreDialog({ player1, player2, bestOf }) {
  return new Promise((resolve) => {
    const done = (v) => { teardown(); resolve(v); };
    const { body: el } = mount(() => done(null));
    const target = Math.ceil(bestOf / 2);

    el.innerHTML = `
      <div class="rlt-modal-title">Enter result</div>
      <div class="rlt-modal-body">First to ${target} wins a best of ${bestOf}.</div>
      <div class="rlt-score-row">
        <label class="rlt-score-side">
          <span class="rlt-score-name">${esc(player1)}</span>
          <input class="rlt-score-input" type="number" min="0" max="${bestOf}" step="1" value="0" data-side="1">
        </label>
        <span class="rlt-score-sep">—</span>
        <label class="rlt-score-side">
          <span class="rlt-score-name">${esc(player2)}</span>
          <input class="rlt-score-input" type="number" min="0" max="${bestOf}" step="1" value="0" data-side="2">
        </label>
      </div>
      <div class="rlt-modal-error" data-role="error"></div>
      <div class="rlt-modal-actions">
        <button class="btn-sm" data-act="cancel">Cancel</button>
        <button class="btn-sm primary" data-act="ok" disabled>Save result</button>
      </div>`;

    const in1 = el.querySelector('[data-side="1"]');
    const in2 = el.querySelector('[data-side="2"]');
    const errEl = el.querySelector('[data-role="error"]');
    const okBtn = el.querySelector('[data-act="ok"]');

    const read = () => [parseInt(in1.value, 10), parseInt(in2.value, 10)];

    const revalidate = () => {
      const [s1, s2] = read();
      const v = validateScore(s1, s2, bestOf);
      okBtn.disabled = !v.ok;
      // Stay quiet at the untouched 0-0 rather than greeting the organiser with an error.
      errEl.textContent = (v.ok || (s1 === 0 && s2 === 0)) ? '' : v.error;
      return v.ok;
    };

    const submit = () => {
      if (!revalidate()) return;
      const [s1, s2] = read();
      done({ s1, s2 });
    };

    for (const input of [in1, in2]) {
      input.addEventListener('input', revalidate);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    okBtn.addEventListener('click', submit);

    revalidate();
    in1.focus();
    in1.select();
  });
}

/// Exposed for tests and for teardown when the tab is re-rendered under an open dialog.
export function closeDialog() {
  teardown();
}

export function isDialogOpen() {
  return _open !== null;
}
