// rl-hub-register.js — registration form logic
import { storageGetUser, esc, request } from '../plugin-sdk.js';
import { registerMember, SK, getChannelId } from './rl-hub-main.js';

let _onSave = null;
let _isEdit = false;

export function initRegisterForm({ onSave }) {
  _onSave = onSave;
}

export async function showRegisterScreen(isEdit = false) {
  _isEdit = isEdit;

  if (isEdit) {
    const account = await storageGetUser(SK.MY_ACCOUNT);
    if (account) {
      const plat   = document.getElementById('reg-platform');
      const user   = document.getElementById('reg-username');
      const epic   = document.getElementById('reg-epic');
      const twitch = document.getElementById('reg-twitch');
      if (plat)   plat.value   = account.platform       ?? 'epic';
      if (user)   user.value   = account.rlUsername      ?? '';
      if (epic)   epic.value   = account.epicFriendName  ?? '';
      if (twitch) twitch.value = account.twitchUsername  ?? '';
    }
  }

  // Only offer Cancel when editing — during first registration there is no hub
  // to return to.
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !isEdit);

  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const screen = document.getElementById('screen-register');
  if (screen) screen.classList.remove('hidden');

  const btn = screen?.querySelector('.btn-primary');
  if (btn) btn.textContent = isEdit ? 'Save Changes' : 'Connect Account';
}

async function submitRegistration() {
  const platform       = document.getElementById('reg-platform')?.value?.trim();
  const rlUsername     = document.getElementById('reg-username')?.value?.trim();
  const epicFriendName = document.getElementById('reg-epic')?.value?.trim()    ?? '';
  const twitchUsername = document.getElementById('reg-twitch')?.value?.trim()  ?? '';
  const errorEl        = document.getElementById('reg-error');
  const btn            = document.querySelector('#screen-register .btn-primary');

  if (errorEl) errorEl.classList.add('hidden');

  if (!platform || !rlUsername) {
    if (errorEl) { errorEl.textContent = 'Platform and Rocket League username are required.'; errorEl.classList.remove('hidden'); }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

  try {
    await registerMember({ platform, rlUsername, epicFriendName, twitchUsername });
    if (_onSave) await _onSave();
  } catch (err) {
    if (errorEl) { errorEl.textContent = 'Failed to save. Please try again.'; errorEl.classList.remove('hidden'); }
    if (btn) { btn.disabled = false; btn.textContent = _isEdit ? 'Save Changes' : 'Connect Account'; }
  }
}

const RL_GAME = 'rocket-league';

/** Reflects desktop capability + binding state into the Live Broadcast section. */
async function refreshBroadcastUi() {
  const btn = document.getElementById('btn-broadcast');
  const status = document.getElementById('broadcast-status');
  if (!btn || !status) return;

  let st;
  try {
    st = await request('game.telemetry.status', { game: RL_GAME });
  } catch {
    btn.disabled = true;
    btn.textContent = 'Unavailable';
    status.textContent = 'This version of Dissent cannot broadcast matches.';
    return;
  }

  // Web and Android answer desktop:false rather than failing — say so plainly instead
  // of leaving a button that looks live and does nothing.
  if (!st.desktop) {
    btn.disabled = true;
    btn.textContent = 'Desktop app required';
    status.textContent = 'Broadcasting needs the Dissent desktop app. You can still watch other players\u2019 matches here on any device.';
    return;
  }

  btn.disabled = false;
  if (st.bound) {
    btn.textContent = 'Stop broadcasting';
    btn.classList.add('btn-companion-success');
    status.textContent = st.streaming
      ? 'Live \u2014 sending match data to this channel.'
      : st.running
        ? 'Rocket League is running but not sending data yet. Check PacketSendRate in DefaultStatsAPI.ini, then restart the game.'
        : 'On. Match data will appear here as soon as you start Rocket League.';
  } else {
    btn.textContent = 'Broadcast to this channel';
    btn.classList.remove('btn-companion-success');
    status.textContent = 'Off. Nothing is read from your computer.';
  }
}

async function toggleBroadcast() {
  const btn = document.getElementById('btn-broadcast');
  const status = document.getElementById('broadcast-status');
  if (!btn) return;
  btn.disabled = true;

  let bound = false;
  try {
    const st = await request('game.telemetry.status', { game: RL_GAME });
    bound = Boolean(st.bound);
  } catch { /* fall through to bind */ }

  try {
    if (bound) await request('game.telemetry.unbind', { game: RL_GAME });
    else       await request('game.telemetry.bind',   { game: RL_GAME, channelId: getChannelId() });
  } catch (err) {
    if (status) status.textContent = (err && err.message) ? err.message : 'Could not change broadcast setting.';
  }
  await refreshBroadcastUi();
}

async function copyIniPath() {
  const btn = document.getElementById('btn-copy-path');
  const path = document.getElementById('ini-path');
  if (!btn || !path) return;
  try {
    await navigator.clipboard.writeText(path.textContent.trim());
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Select it manually';
  }
  setTimeout(() => { btn.textContent = 'Copy path'; }, 2000);
}

window._rlHubSubmitReg      = submitRegistration;
window.toggleBroadcast      = toggleBroadcast;
window.copyIniPath          = copyIniPath;
window._rlHubRefreshBroadcast = refreshBroadcastUi;
