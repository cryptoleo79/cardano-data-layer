// GeckoTerminal adapter — on-chain DEX market data for Cardano tokens.
//
// Why this source: the ranking engine previously derived market cap from Koios
// `total_supply` (which for protocol tokens like Djed's DJED/SHEN is the *mint
// cap*, ~1e12, not circulating) and read liquidity from Minswap (whose public
// API host is now dead). Both produced wrong or empty rankings. GeckoTerminal
// (free, keyless) exposes, per token, in ONE call:
//   - market_cap_usd      circulating market cap (via CoinGecko) — the honest one
//   - fdv_usd             fully-diluted (price x total supply) — the fallback
//   - total_reserve_in_usd aggregate pool liquidity across DEXes
//   - volume_usd.h24      real 24h traded volume
//   - price_usd, total_supply, decimals
// So one source restores accurate mcap, liquidity, and volume together.
//
// Coverage is honest: tokens GeckoTerminal/CoinGecko don't track simply return
// null for the fields they don't have (e.g. mcap null for long-tail tokens that
// still have liquidity/volume). We never fabricate — a missing field stays null.
//
// Rate limit: free tier is ~30 calls/min. We batch up to 30 units per call via
// the /tokens/multi endpoint and pace chunks ~2s apart, so the whole tracked set
// is a handful of calls well under the limit. Adapters stay dumb (return data or
// null); the module/poller own caching, persistence, and fallback policy.

import { fetchJSON } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'geckoterminal';
const NETWORK = 'cardano';
const MULTI_MAX = 30;          // GeckoTerminal caps /tokens/multi at 30 addresses
// The keyless free tier throttles hard: bursts of more than ~3 multi-calls trip
// a sustained 429 (observed empirically; documented "30/min" is not what the
// keyless tier actually grants). So we pace gently and rely on rotation +
// persistence: whatever a tick can't refresh keeps its last value and is picked
// up on a later tick (and flagged stale meanwhile). Pace is deliberately slow.
const CHUNK_PACE_MS = 5_000;
const ACCEPT = 'application/json;version=20230302';

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize one GeckoTerminal token object into our market-data shape. */
function normalize(d) {
  if (!d || !d.attributes) return null;
  const a = d.attributes;
  const unit = (a.address || (typeof d.id === 'string' ? d.id.split('_').pop() : null) || '').toLowerCase();
  if (!unit) return null;
  const priceUsd = num(a.price_usd);
  // Price-derived valuations are only trustworthy with a price behind them.
  // GeckoTerminal occasionally returns an orphaned market_cap_usd with a null
  // price (observed: a token reporting a $24B "market cap" and no price) — those
  // are corrupt and would otherwise top the ranking. Drop mcap/FDV when there is
  // no price; liquidity and 24h volume are real USD figures independent of spot
  // price, so they are kept regardless.
  const priced = priceUsd != null;
  return {
    unit,
    symbol: a.symbol ?? null,
    priceUsd,
    mcapUsd: priced ? num(a.market_cap_usd) : null,  // circulating (CoinGecko); null when untracked/unpriced
    fdvUsd: priced ? num(a.fdv_usd) : null,           // price x total supply
    liquidityUsd: num(a.total_reserve_in_usd),
    volume24hUsd: num(a.volume_usd ? a.volume_usd.h24 : null),
    totalSupply: num(a.total_supply),
    decimals: a.decimals == null ? null : Number(a.decimals),
    source: SOURCE,
  };
}

/**
 * Fetch market data for many units. Returns a Map<unit, marketData>. Units the
 * source doesn't know are simply absent from the map (caller treats as null).
 * Never throws on a single chunk failure — that chunk is skipped and logged via
 * the optional `log`; partial coverage beats no coverage.
 * @param {string[]} units lowercase policyId+hexName units
 * @param {{log?:Function}} [opts]
 * @returns {Promise<Map<string, object>>}
 */
export async function tokenMarketData(units, opts = {}) {
  const out = new Map();
  const clean = [...new Set((units || []).map((u) => (u || '').toLowerCase()).filter((u) => /^[0-9a-f]+$/.test(u)))];
  for (let i = 0; i < clean.length; i += MULTI_MAX) {
    const chunk = clean.slice(i, i + MULTI_MAX);
    const url = `${config.sources.geckoterminal.base}/networks/${NETWORK}/tokens/multi/${chunk.join(',')}`;
    try {
      const data = await fetchJSON(url, { source: SOURCE, headers: { accept: ACCEPT }, retries: 1, timeoutMs: 12_000 });
      for (const d of (data && Array.isArray(data.data) ? data.data : [])) {
        const rec = normalize(d);
        if (rec) out.set(rec.unit, rec);
      }
    } catch (err) {
      opts.log?.(`geckoterminal chunk ${i / MULTI_MAX} failed: ${err.message}`);
    }
    if (i + MULTI_MAX < clean.length) await sleep(CHUNK_PACE_MS);
  }
  return out;
}

/** Single-token convenience (used by /token/mcap). Returns marketData or null. */
export async function tokenMarket(unit) {
  if (!unit || !/^[0-9a-f]+$/.test(unit)) return null;
  const url = `${config.sources.geckoterminal.base}/networks/${NETWORK}/tokens/${unit}`;
  try {
    const data = await fetchJSON(url, { source: SOURCE, headers: { accept: ACCEPT }, retries: 1, timeoutMs: 10_000 });
    return normalize(data && data.data ? data.data : null);
  } catch {
    return null;
  }
}

export default { tokenMarketData, tokenMarket };
