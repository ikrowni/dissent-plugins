// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/polymarket.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../../polymarket.js' directly would make the plugin unmirrorable.

// plugins/polymarket.js — the SHARED Polymarket capability, for every plugin.
//
// ⚠️ NOT IMPORTED DIRECTLY. This file is the SOURCE; consumers import a generated copy
// inside their own directory (ufc-hub gets `core/polymarket-trade.js`). A mirror may only
// serve files from under a plugin's own directory, so a direct `../../polymarket.js`
// import silently pins that plugin to whoever published it. Edit this file, then run
// `node scripts/vendor-shared.mjs`; `--check` fails the deploy if a copy drifts.
//
// That keeps the one-choke-point argument below literally true rather than aspirational:
// the module still lives in exactly one place, and the copies are build output.
//
// WHY SHARED, NOT PER-PLUGIN. The product requirement is a switch between "users place
// real bets here" and "users are sent to Polymarket". A switch that must behave
// identically across N plugins cannot live in N places — the third plugin ships a Bet
// button that ignores the setting, and it moves real money. One module means one choke
// point (`placeBet`) and one thing to audit.
//
// ── THE THREE LAYERS, AND WHY THERE ARE THREE ──────────────────────────────────
//
//   1. MODE      per-install `config.betting_mode` ('link' | 'trade'), set by a server
//                owner through the existing config UI. Controls what users SEE.
//   2. GRANT     `clob.polymarket.com` in the install's allowed_fetch_domains. Controls
//                whether an order can physically leave the node. Enforced by the proxy,
//                which a plugin cannot talk its way past.
//   3. PROTOCOL  this file.
//
// Mode is convenience; the GRANT is the control. If mode says 'trade' and the grant is
// absent, `submitOrder` gets a 403 from the node and the caller falls back to the link.
// That is deliberate: the easy switch must not be the only thing standing between a
// misconfiguration and a real-money order.
//
// ⚠️ DEFAULT IS 'link'. An unset, malformed or unreadable config resolves to link-out,
// never to trading. Nothing about real money should be reachable by omission.
//
// ⚠️ VENUE IS CONFIGURABLE AND THAT MATTERS LEGALLY. `global` is the crypto-native
// venue (self-custody, Polygon USDC.e). `us` is QCX, LLC d/b/a Polymarket US, the
// CFTC-regulated Designated Contract Market. They are different entities under different
// rules — see docs/decisions.md in the meta repo. The default is `global` only because it
// is the venue whose API this code was written against; it is NOT a recommendation.
//
// ⚠️ THE ORDER PATH HAS NEVER EXECUTED against a live venue. Everything deterministic
// here is unit-tested; the network round-trip is not, because testing it means placing a
// real order with real money. Treat first live use as a test, with a trivial amount.
import {
  request, storageLocalGet, storageLocalSet, storageLocalDelete, INTERACTIVE_TIMEOUT_MS,
} from '../../plugin-sdk.js';

export const MODE = { LINK: 'link', TRADE: 'trade' };

export const VENUES = {
  global: {
    id: 'global',
    label: 'Polymarket (global)',
    site: 'https://polymarket.com',
    gamma: 'https://gamma-api.polymarket.com',
    clob: 'https://clob.polymarket.com',
    chainId: 137,
    // USDC.e (PoS bridged) — Polymarket's settlement token on Polygon. NOT native USDC;
    // sending native USDC here is a way to lose funds.
    collateral: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    exchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  },
  us: {
    id: 'us',
    label: 'Polymarket US (CFTC-regulated DCM)',
    site: 'https://polymarket.us',
    gamma: 'https://gamma-api.polymarket.com',
    // ⚠️ PLACEHOLDER. Polymarket US onboards API access by application and issues its
    // own credentials; this endpoint and the auth scheme below are NOT verified against
    // it. Do not switch a live server to this venue until the endpoints are confirmed.
    clob: null,
    chainId: null,
    collateral: null,
    exchange: null,
  },
};

export function venueFor(config) {
  const id = String(config?.polymarket_venue ?? 'global').toLowerCase();
  return VENUES[id] ?? VENUES.global;
}

/**
 * 'link' | 'trade', from the per-install config.
 *
 * ⚠️ Anything other than the exact string 'trade' resolves to link. A typo, a missing
 * key, a boolean, a null config — all of them mean "do not move money".
 */
export function resolveMode(config) {
  return config?.betting_mode === MODE.TRADE ? MODE.TRADE : MODE.LINK;
}

/** True only when this install is configured to place real orders. */
export const canTrade = (config) => resolveMode(config) === MODE.TRADE;

/**
 * The market's own page.
 *
 * ⚠️ DELIBERATELY BARE — no referral code, affiliate parameter or UTM. The NFA treats
 * referral of customers to an FCM "when compensated on a per-trade basis or by referral
 * fee" as introducing-broker activity requiring registration. Adding a parameter here
 * changes this project's regulatory posture, not its styling.
 */
export function marketUrl(slug, config) {
  const s = String(slug ?? '').trim();
  if (!s) return null;
  return `${venueFor(config).site}/event/${encodeURIComponent(s)}`;
}

const CREDS_KEY = 'clob-creds';

function proxyFetch(url, opts = {}) {
  return request('fetch:external', {
    url, method: opts.method || 'GET', headers: opts.headers, body: opts.body,
  });
}

// ── credentials ──────────────────────────────────────────────────────────────
// Device-only: storageLocal never reaches the node, so CLOB API secrets stay on the
// machine that derived them.

export async function getStoredCreds() {
  const c = await storageLocalGet(CREDS_KEY);
  return c && c.address && c.apiKey ? c : null;
}

export async function clearCreds() {
  await storageLocalDelete(CREDS_KEY);
}

export async function collateralBalance(config) {
  const v = venueFor(config);
  if (!v.collateral) throw new Error(`venue ${v.id} has no collateral token configured`);
  const r = await request('wallet.balance', { tokenContract: v.collateral, decimals: 6 });
  return r.balance;
}

/** Connect the wallet, then derive CLOB API creds if none are cached for that address. */
export async function connectAndAuth(config) {
  const v = venueFor(config);
  if (!v.clob) throw new Error(`venue ${v.id} has no CLOB endpoint configured`);

  const { address } = await request('wallet.connect', { chainId: v.chainId },
    INTERACTIVE_TIMEOUT_MS);
  const cached = await getStoredCreds();
  if (cached && cached.address.toLowerCase() === address.toLowerCase()) return cached;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Polymarket's ClobAuth EIP-712 type uses uint256 for nonce, not string.
  const nonce = 0;
  const { signature } = await request('wallet.signTypedData', {
    domain: { name: 'ClobAuthDomain', version: '1', chainId: v.chainId },
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
    message: {
      address, timestamp, nonce,
      message: 'This message attests that I control the given wallet',
    },
    summary: 'Authenticate with Polymarket (no funds move)',
  }, INTERACTIVE_TIMEOUT_MS);

  // CLOB L1 auth: credentials go in headers, with no body and no Content-Type.
  const res = await proxyFetch(`${v.clob}/auth/api-key`, {
    method: 'POST',
    headers: {
      POLY_ADDRESS: address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    },
  });
  if (res.status !== 200) {
    throw new Error(`Polymarket credential request failed: ${res.status}`);
  }
  const json = JSON.parse(res.body);
  const creds = {
    address, apiKey: json.apiKey, secret: json.secret, passphrase: json.passphrase,
  };
  await storageLocalSet(CREDS_KEY, creds);
  return creds;
}

// ── order construction ───────────────────────────────────────────────────────

/**
 * Order amounts, in the integer units the exchange expects.
 *
 * `makerAmount` is what you pay, in collateral base units (6 decimals). `takerAmount` is
 * the shares you receive: stake / price. A share pays out 1 unit if the outcome resolves
 * true, so price is also the implied probability.
 */
export function buildOrderParams(market, outcomeIndex, amount, makerAddress) {
  const price = Number(market?.outcomePrices?.[outcomeIndex]);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new Error(`unusable price for outcome ${outcomeIndex}`);
  }
  const stake = Number(amount);
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('amount must be positive');
  const tokenId = market?.tokens?.[outcomeIndex]?.token_id;
  if (!tokenId) throw new Error(`no token id for outcome ${outcomeIndex}`);

  const makerAmount = BigInt(Math.round(stake * 1_000_000));
  const takerAmount = BigInt(Math.floor(Number(makerAmount) / price));
  // Number.MAX_SAFE_INTEGER is plenty of entropy for a replay salt and keeps this
  // dependency-free; the signature is what actually binds the order.
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const maker = makerAddress ?? '';
  return { tokenId, side: 0, makerAmount, takerAmount, salt, maker, signer: maker };
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

export async function signOrder(params, market, outcomeLabel, amount, config) {
  const v = venueFor(config);
  const orderData = {
    salt: params.salt.toString(),
    maker: params.maker,
    signer: params.signer,
    taker: ZERO_ADDR,
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
    domain: {
      name: 'Polymarket CTF Exchange', version: '1',
      chainId: v.chainId, verifyingContract: v.exchange,
    },
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
    // The host shows this string in its confirm modal. It is the last thing a user reads
    // before real money moves, so it names the stake, the side and the market.
    summary: `Bet ${amount} on "${outcomeLabel}" — ${market?.question ?? 'market'}`,
    message: orderData,
  }, INTERACTIVE_TIMEOUT_MS);

  return {
    ...params, signature, signatureType: 0, expiration: 0, nonce: 0, feeRateBps: 0,
    taker: ZERO_ADDR,
  };
}

async function hmacSha256Base64(secret, message) {
  const enc = new TextEncoder();
  // The CLOB L2 secret is base64 — decode to raw bytes before using it as an HMAC key.
  const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Serialise a signed order exactly as the CLOB expects. Separated so it is testable. */
export function orderBody(signed) {
  return JSON.stringify({
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
}

export async function submitOrder(signed, creds, config) {
  const v = venueFor(config);
  if (!v.clob) throw new Error(`venue ${v.id} has no CLOB endpoint configured`);
  const path = '/order';
  const method = 'POST';
  const body = orderBody(signed);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSha256Base64(creds.secret, timestamp + method + path + body);

  const res = await proxyFetch(`${v.clob}${path}`, {
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
  // ⚠️ A 403 here is the DOMAIN GRANT, not the exchange: the node rejects a fetch to a
  // host this install has not been granted. That is the capability layer doing its job,
  // and the caller should fall back to the link rather than report an exchange error.
  if (res.status === 403) {
    const e = new Error('clob.polymarket.com is not granted to this install');
    e.code = 'NOT_GRANTED';
    throw e;
  }
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`CLOB API error ${res.status}: ${res.body}`);
  }
  return { orderId: JSON.parse(res.body).orderID };
}

/**
 * THE ONE ENTRY POINT. Every plugin places a bet through here, and nowhere else.
 *
 * Refuses unless the install is explicitly in trade mode. That check lives here rather
 * than in each caller precisely so that forgetting it is impossible.
 */
export async function placeBet({ market, outcomeIndex, outcomeLabel, amount, config }) {
  if (!canTrade(config)) {
    const e = new Error('this server is not configured for in-app betting');
    e.code = 'MODE_LINK';
    throw e;
  }
  const creds = await connectAndAuth(config);
  const params = buildOrderParams(market, outcomeIndex, amount, creds.address);
  const signed = await signOrder(params, market, outcomeLabel, amount, config);
  return submitOrder(signed, creds, config);
}
