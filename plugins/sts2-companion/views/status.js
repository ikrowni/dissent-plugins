// views/status.js — every non-ok game.saves answer, in plain words (spec §3.2, §3.3).
// A status is data, never an exception: the section explains itself instead of sitting empty.

import { h } from '../core/dom.js';

export const STATUS_TEXT = {
  desktop_only: 'Your runs are read from this computer by the Dissent desktop app. Open Dissent desktop to see them.',
  no_current_run: 'No run in progress.',
  no_game_data: 'No Slay the Spire 2 saves were found on this computer.',
  unsupported_version: 'The game changed its save format. Dissent desktop needs an update to read it.',
  unsupported_coop: 'Co-op runs in progress are not supported yet. Finished co-op runs are in Run History.',
  unreadable: 'The save could not be read — the game was probably writing it. It will try again on the next room.',
  not_found: 'That run is no longer in your history.',
  unsupported_game: 'This game is not supported.',
  error: 'Dissent could not read your saves.',
};

export const statusText = (status) => STATUS_TEXT[status] ?? `Unexpected answer from Dissent: ${status}`;

/** `extra` is appended after the sentence — e.g. a button to the Builder. */
export function statusBlock(result, extra = null) {
  const status = result?.status ?? 'error';
  return h('div', { class: 'empty status', dataset: { status } }, h('p', {}, statusText(status)), extra);
}
