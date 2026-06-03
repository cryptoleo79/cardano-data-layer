// Minswap adapter — Minswap DEX public API.
//
// Minswap exposes pool state (reserves, token pairs) and, for some deployments,
// price/volume aggregates. We use it as a second on-chain price source to
// cross-check DexHunter, and to read pool liquidity where available. Base URL
// from config.sources.minswap.base.
//
// IMPORTANT: Minswap's public surface has shifted over time and may be
// unreachable from some networks/regions. Every function here therefore treats
// any transport/HTTP error as "no data" (returns null) rather than throwing, so
// the module can fall back to DexHunter and still answer. Adapters stay dumb;
// the module owns caching and fallback policy.

import { fetchJSON } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'minswap';

// Candidate spot-price endpoints across Minswap API generations. We try them in
// order and use the first that yields a usable ADA price. Keeping this list
// here (rather than the module) localizes upstream-shape knowledge to the
// adapter.
const PRICE_PATHS = [
  // Newer aggregator-style: returns token objects with a price in ADA.
  (unit) => `/aggregator/tokens?query=${encodeURIComponent(unit)}`,
  // DeFi v2 token detail.
  (unit) => `/defi/v2/tokens/${encodeURIComponent(unit)}`,
];

/**
 * Pull a normalized record for `unit` from whichever Minswap endpoint answers.
 * @returns {Promise<{adaPerToken:number|null, priceUsd:number|null,
 *   liquidityAda:number|null, volume24hAda:number|null, source:string}|null>}
 */
export async function tokenStats(unit) {
  if (unit === 'lovelace') {
    return { adaPerToken: 1, priceUsd: null, liquidityAda: null, volume24hAda: null, source: SOURCE };
  }
  for (const buildPath of PRICE_PATHS) {
    const url = `${config.sources.minswap.base}${buildPath(unit)}`;
    let data;
    try {
      data = await fetchJSON(url, { source: SOURCE, retries: 1, timeoutMs: 8000 });
    } catch {
      // Endpoint missing / host unreachable — try the next candidate.
      continue;
    }
    const rec = normalize(data, unit);
    if (rec) return rec;
  }
  return null;
}

/**
 * Best-effort normalization across Minswap response shapes. Returns null if no
 * recognizable ADA price is present. We deliberately read several possible field
 * names because the public schema is not contractually stable.
 */
function normalize(data, unit) {
  if (!data) return null;
  // Some endpoints return an array of token matches; pick the exact unit.
  const obj = Array.isArray(data)
    ? data.find((t) => t && (t.unit === unit || t.token === unit || t.id === unit)) || data[0]
    : data;
  if (!obj || typeof obj !== 'object') return null;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && Number.isFinite(Number(v)) ? Number(v) : null));

  const adaPerToken = num(obj.priceInAda ?? obj.price_ada ?? obj.priceAda ?? obj.price);
  const priceUsd = num(obj.priceInUsd ?? obj.price_usd ?? obj.priceUsd ?? obj.usdPrice);
  const liquidityAda = num(obj.liquidityInAda ?? obj.tvlInAda ?? obj.liquidity ?? obj.tvl);
  const volume24hAda = num(obj.volume24hInAda ?? obj.volume24h ?? obj.volumeInAda);

  if (adaPerToken == null && priceUsd == null && liquidityAda == null) return null;
  return { adaPerToken, priceUsd, liquidityAda, volume24hAda, source: SOURCE };
}

/**
 * Convenience wrapper returning just the ADA spot price (or null). Mirrors the
 * DexHunter adapter's shape so the module can treat sources uniformly.
 */
export async function averagePriceInAda(unit) {
  const s = await tokenStats(unit);
  if (!s || s.adaPerToken == null) return null;
  return { adaPerToken: s.adaPerToken, tokenPerAda: s.adaPerToken ? 1 / s.adaPerToken : null, source: SOURCE };
}

export default { tokenStats, averagePriceInAda };
