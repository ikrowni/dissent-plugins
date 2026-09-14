// core/partyCrypto.js — party codes, and sealing runs so only people with the code can read them.
//
// A code is 12 characters of Crockford base32 (60 random bits). From it every member derives the same
// channel id (what the relay files the data under) and AES-GCM key (what seals it). The relay sees the
// channel and sealed bytes only; without the code it can neither read a run nor find a channel to read.
//
// ⚠️ Needs WebCrypto (crypto.subtle): present in Dissent desktop and the web app, both secure contexts.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const enc = new TextEncoder();

export function newPartyCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => ALPHABET[b % 32]).join(''); // 256 % 32 === 0: uniform
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** The 12 canonical characters, or null. Forgiving of case, spaces, dashes, O→0 and I/L→1. */
export function normalizeCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === 12 && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const formatCode = (code) => {
  const s = normalizeCode(code);
  return s ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : null;
};

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function deriveParty(code) {
  const c = normalizeCode(code);
  if (!c) throw new Error('not a party code');
  const channel = hex(await crypto.subtle.digest('SHA-256', enc.encode(`sts2-companion party channel v1|${c}`))).slice(0, 32);
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`sts2-companion party key v1|${c}`));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { code: c, channel, key };
}

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/** base64(iv ‖ AES-GCM(JSON)). */
export async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return toB64(out);
}

/** The sealed value, or a rejection when the key is wrong or the bytes were altered. */
export async function openSealed(key, sealed) {
  const bytes = fromB64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
