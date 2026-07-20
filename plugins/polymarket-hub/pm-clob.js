// pm-clob.js — Polymarket market search + CLOB auth/order flow, entirely in-plugin.
// Uses only general capabilities: fetch:external (node proxy), wallet.connect/balance/
// signTypedData (host-mediated, every signature behind the host's confirm modal), and
// storage:local (device-only CLOB API creds — the node never sees them).
// Ported from the pre-capability core code (src/lib/polymarket/{gamma,clob,wallet}.ts).
import { request, storageLocalGet, storageLocalSet, storageLocalDelete } from '../plugin-sdk.js';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
// USDC.e (PoS bridged) — Polymarket settlement token on Polygon. Not native USDC.
export const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CREDS_KEY = 'clob-creds';

function proxyFetch(url, opts = {}) {
  return request('fetch:external', {
    url,
    method: opts.method || 'GET',
    headers: opts.headers,
    body: opts.body,
  });
}

// ── Gamma market search ─────────────────────────────────────────────────────

export async function searchMarkets(query) {
  try {
    const url = `${GAMMA_BASE}/markets?_limit=5&_order=volume&active=true&closed=false&search=${encodeURIComponent(query)}`;
    const res = await proxyFetch(url, { headers: { Accept: 'application/json' } });
    if (res.status !== 200) return [];
    const raw = JSON.parse(res.body);
    return raw.map((m) => ({
      conditionId: m.conditionId,
      question: m.question,
      outcomes: JSON.parse(m.outcomes),
      outcomePrices: JSON.parse(m.outcomePrices).map(Number),
      tokens: m.tokens,
      active: m.active,
      closed: m.closed,
    }));
  } catch {
    return [];
  }
}

// ── Wallet connect + CLOB L1→L2 auth ────────────────────────────────────────

export async function getStoredCreds() {
  const c = await storageLocalGet(CREDS_KEY);
  return c && c.address && c.apiKey ? c : null;
}

export async function clearCreds() {
  await storageLocalDelete(CREDS_KEY);
}

export async function usdcBalance() {
  const r = await request('wallet.balance', { tokenContract: USDC_CONTRACT, decimals: 6 });
  return r.balance;
}

/** Connect the wallet (Polygon), derive CLOB API creds if not cached. Returns creds. */
export async function connectAndAuth() {
  const { address } = await request('wallet.connect', { chainId: 137 });
  const cached = await getStoredCreds();
  if (cached && cached.address.toLowerCase() === address.toLowerCase()) return cached;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Polymarket's ClobAuth EIP-712 type uses uint256 for nonce, not string.
  const nonce = 0;
  const { signature } = await request('wallet.signTypedData', {
    domain: { name: 'ClobAuthDomain', version: '1', chainId: 137 },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ClobAuth: [
        { name: 'address', type: 'address' },
        { name: 'timestamp', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'message', type: 'string' },
      ],
    },
    primaryType: 'ClobAuth',
    message: { address, timestamp, nonce, message: 'This message attests that I control the given wallet' },
    summary: 'Authenticate with Polymarket (no funds move)',
  });

  // CLOB L1 auth: credentials go in request headers, no body or Content-Type.
  const res = await proxyFetch(`${CLOB_BASE}/auth/api-key`, {
    method: 'POST',
    headers: {
      POLY_ADDRESS: address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    },
  });
  if (res.status !== 200) throw new Error(`Polymarket credential request failed: ${res.status}`);
  const json = JSON.parse(res.body);
  const creds = { address, apiKey: json.apiKey, secret: json.secret, passphrase: json.passphrase };
  await storageLocalSet(CREDS_KEY, creds);
  return creds;
}

// ── Order build / sign / submit ─────────────────────────────────────────────

export function buildOrderParams(market, outcomeIndex, usdcAmount, makerAddress) {
  const price = market.outcomePrices[outcomeIndex];
  const tokenId = market.tokens[outcomeIndex].token_id;
  const makerAmount = BigInt(Math.round(usdcAmount * 1_000_000));
  const takerAmount = BigInt(Math.floor(Number(makerAmount) / price));
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const maker = makerAddress ?? '';
  return { tokenId, side: 0, makerAmount, takerAmount, salt, maker, signer: maker };
}

export async function signOrder(params, market, outcomeLabel, usdcAmount) {
  const orderData = {
    salt: params.salt.toString(),
    maker: params.maker,
    signer: params.signer,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: params.tokenId,
    makerAmount: params.makerAmount.toString(),
    takerAmount: params.takerAmount.toString(),
    expiration: '0',
    nonce: '0',
    feeRateBps: '0',
    side: params.side,
    signatureType: 0,
  };
  const { signature } = await request('wallet.signTypedData', {
    domain: { name: 'Polymarket CTF Exchange', version: '1', chainId: 137, verifyingContract: CTF_EXCHANGE },
    types: {
      Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'makerAmount', type: 'uint256' },
        { name: 'takerAmount', type: 'uint256' },
        { name: 'expiration', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'feeRateBps', type: 'uint256' },
        { name: 'side', type: 'uint8' },
        { name: 'signatureType', type: 'uint8' },
      ],
    },
    primaryType: 'Order',
    message: orderData,
    summary: `Bet $${usdcAmount} on "${outcomeLabel}" — ${market.question}`,
  });
  return { ...params, signature, signatureType: 0, expiration: 0, nonce: 0, feeRateBps: 0, taker: '0x0000000000000000000000000000000000000000' };
}

async function hmacSha256Base64(secret, message) {
  const enc = new TextEncoder();
  // CLOB L2 secret is returned base64-encoded — decode to raw bytes before use as key.
  const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function submitOrder(signed, creds) {
  const path = '/order';
  const method = 'POST';
  const body = JSON.stringify({
    order: {
      salt: signed.salt.toString(),
      maker: signed.maker,
      signer: signed.signer,
      taker: signed.taker,
      tokenId: signed.tokenId,
      makerAmount: signed.makerAmount.toString(),
      takerAmount: signed.takerAmount.toString(),
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: signed.side === 0 ? 'BUY' : 'SELL',
      signatureType: '0',
      signature: signed.signature,
    },
    orderType: 'GTC',
    marketType: 'CPMM',
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmacMsg = timestamp + method + path + body;
  const signature = await hmacSha256Base64(creds.secret, hmacMsg);

  const res = await proxyFetch(`${CLOB_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      POLY_ADDRESS: creds.address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_API_KEY: creds.apiKey,
      POLY_PASSPHRASE: creds.passphrase,
    },
    body,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`CLOB API error ${res.status}: ${res.body}`);
  }
  const json = JSON.parse(res.body);
  return { orderId: json.orderID };
}
