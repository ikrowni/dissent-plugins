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

async function copyAuthToken() {
  const btn = document.getElementById('btn-copy-token');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Copying…';
  try {
    await request('auth:copy-token', {});
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Auth Token'; btn.disabled = false; }, 2000);
  } catch {
    btn.textContent = 'Failed — try again';
    setTimeout(() => { btn.textContent = 'Copy Auth Token'; btn.disabled = false; }, 2500);
  }
}

async function installCompanion() {
  const btn = document.getElementById('btn-install-companion');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Copying command…';
  try {
    await request('auth:install-companion', { channelId: getChannelId() });
    btn.textContent = '✓ Paste into PowerShell!';
    btn.classList.add('btn-companion-success');
    const hint = document.getElementById('install-hint');
    if (hint) hint.classList.remove('hidden');
    setTimeout(() => {
      btn.textContent = 'Install on Windows';
      btn.classList.remove('btn-companion-success');
      btn.disabled = false;
    }, 6000);
  } catch {
    btn.textContent = 'Failed — try again';
    setTimeout(() => { btn.textContent = 'Install on Windows'; btn.disabled = false; }, 2500);
  }
}

window._rlHubSubmitReg    = submitRegistration;
window.copyAuthToken      = copyAuthToken;
window.installCompanion   = installCompanion;
