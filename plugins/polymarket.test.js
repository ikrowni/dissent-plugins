import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MODE, VENUES, venueFor, resolveMode, canTrade, marketUrl,
  buildOrderParams, orderBody, placeBet,
} from './polymarket.js';

describe('resolveMode / canTrade', () => {
  it('is trade ONLY for the exact string', () => {
    expect(resolveMode({ betting_mode: 'trade' })).toBe(MODE.TRADE);
    expect(canTrade({ betting_mode: 'trade' })).toBe(true);
  });

  it('DEFAULTS TO LINK for everything else', () => {
    // ⚠️ THE SAFETY PROPERTY OF THIS MODULE. Nothing about real money may be reachable
    // by omission, typo or type confusion. Every one of these must mean "do not trade".
    for (const cfg of [
      undefined, null, {}, { betting_mode: null }, { betting_mode: '' },
      { betting_mode: 'Trade' }, { betting_mode: 'TRADE' }, { betting_mode: ' trade' },
      { betting_mode: true }, { betting_mode: 1 }, { betting_mode: 'link' },
      { betting_mode: 'yes' }, { betting_mode: ['trade'] },
    ]) {
      expect(resolveMode(cfg)).toBe(MODE.LINK);
      expect(canTrade(cfg)).toBe(false);
    }
  });
});

describe('venueFor', () => {
  it('defaults to the global venue', () => {
    expect(venueFor(undefined).id).toBe('global');
    expect(venueFor({ polymarket_venue: 'nonsense' }).id).toBe('global');
  });

  it('selects the US venue when asked', () => {
    expect(venueFor({ polymarket_venue: 'us' }).id).toBe('us');
  });

  it('leaves the US venue WITHOUT trading endpoints, because they are unverified', () => {
    // ⚠️ Polymarket US onboards API access by application. Its CLOB endpoint and auth
    // scheme are not confirmed, so the venue must fail loudly rather than silently
    // send orders somewhere plausible-looking.
    expect(VENUES.us.clob).toBe(null);
    expect(VENUES.us.collateral).toBe(null);
  });

  it('uses USDC.e for the global venue, not native USDC', () => {
    // Sending native USDC to Polymarket's settlement contract loses funds.
    expect(VENUES.global.collateral).toBe('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
  });
});

describe('marketUrl', () => {
  it('points at the venue site', () => {
    expect(marketUrl('ufc-x-2026-08-08')).toBe('https://polymarket.com/event/ufc-x-2026-08-08');
    expect(marketUrl('ufc-x', { polymarket_venue: 'us' }))
      .toBe('https://polymarket.us/event/ufc-x');
  });

  it('carries NO referral or affiliate parameter', () => {
    // ⚠️ COMPLIANCE GUARD. Referral of customers to an FCM "when compensated on a
    // per-trade basis or by referral fee" is introducing-broker activity requiring NFA
    // registration. Adding a parameter here changes the project's regulatory posture.
    const u = marketUrl('ufc-x-2026-08-08');
    expect(u.split('?')).toHaveLength(1);
    expect(u).not.toMatch(/(ref|affiliate|utm_|via)=/i);
  });

  it('is null without a slug rather than linking to a homepage', () => {
    expect(marketUrl('')).toBe(null);
    expect(marketUrl(null)).toBe(null);
  });
});

describe('buildOrderParams', () => {
  const market = {
    outcomePrices: [0.4, 0.6],
    tokens: [{ token_id: 'tok-a' }, { token_id: 'tok-b' }],
  };

  it('converts the stake to collateral base units (6 decimals)', () => {
    const p = buildOrderParams(market, 0, 25, '0xabc');
    expect(p.makerAmount).toBe(25_000_000n);
  });

  it('sizes the shares as stake / price', () => {
    // $25 at a 0.4 price buys 62.5 shares -> 62,500,000 base units.
    const p = buildOrderParams(market, 0, 25, '0xabc');
    expect(p.takerAmount).toBe(62_500_000n);
  });

  it('refuses a price of 0 or 1 rather than dividing by zero or minting infinity', () => {
    expect(() => buildOrderParams({ ...market, outcomePrices: [0, 1] }, 0, 5, '0x'))
      .toThrow(/price/i);
    expect(() => buildOrderParams({ ...market, outcomePrices: [1, 0] }, 0, 5, '0x'))
      .toThrow(/price/i);
  });

  it('refuses a non-positive or unparseable stake', () => {
    expect(() => buildOrderParams(market, 0, 0, '0x')).toThrow(/positive/i);
    expect(() => buildOrderParams(market, 0, -5, '0x')).toThrow(/positive/i);
    expect(() => buildOrderParams(market, 0, 'lots', '0x')).toThrow(/positive/i);
  });

  it('refuses an outcome with no token id rather than signing a void order', () => {
    expect(() => buildOrderParams({ ...market, tokens: [] }, 0, 5, '0x')).toThrow(/token/i);
  });
});

describe('orderBody', () => {
  const signed = {
    salt: 1n, maker: '0xm', signer: '0xs', taker: '0x0', tokenId: 'tok',
    makerAmount: 25_000_000n, takerAmount: 62_500_000n, side: 0, signature: '0xsig',
  };

  it('serialises BigInts as strings, which JSON cannot do on its own', () => {
    const b = JSON.parse(orderBody(signed));
    expect(b.order.makerAmount).toBe('25000000');
    expect(b.order.salt).toBe('1');
  });

  it('maps side 0 to BUY and 1 to SELL', () => {
    expect(JSON.parse(orderBody(signed)).order.side).toBe('BUY');
    expect(JSON.parse(orderBody({ ...signed, side: 1 })).order.side).toBe('SELL');
  });
});

describe('placeBet', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('REFUSES when the install is not in trade mode', async () => {
    // ⚠️ THE CHOKE POINT. This check lives here, not in each caller, so that a plugin
    // author cannot forget it. If this test ever goes green with the guard removed,
    // every plugin can move real money regardless of the server's setting.
    await expect(placeBet({
      market: {}, outcomeIndex: 0, outcomeLabel: 'A', amount: 5, config: {},
    })).rejects.toThrow(/not configured for in-app betting/i);

    await expect(placeBet({
      market: {}, outcomeIndex: 0, outcomeLabel: 'A', amount: 5,
      config: { betting_mode: 'link' },
    })).rejects.toThrow(/not configured/i);
  });

  it('tags the refusal so a caller can fall back to the link', async () => {
    const e = await placeBet({ market: {}, outcomeIndex: 0, amount: 1, config: {} })
      .catch((x) => x);
    expect(e.code).toBe('MODE_LINK');
  });

  it('does not reach the network at all when refusing', async () => {
    // The refusal must come BEFORE wallet.connect: a user in link mode should never see
    // a wallet prompt.
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network must not be touched');
    });
    await placeBet({ market: {}, outcomeIndex: 0, amount: 1, config: {} }).catch(() => {});
    expect(spy).not.toHaveBeenCalled();
  });
});
