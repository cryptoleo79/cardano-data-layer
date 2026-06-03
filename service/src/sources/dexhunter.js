// DexHunter adapter — on-chain DEX aggregator.
//
// Used for token spot price via its aggregate "average price" endpoint, which
// returns a liquidity-weighted price across the DEXes DexHunter routes through.
// This is a read-only, key-free path: GET /swap/averagePrice/{A}/{B} returns
// { averagePrice, price_ab, price_ba } where (verified against live data):
//   price_ab = how many B you get for 1 A  ("B per A")
//   price_ba = how many A you get for 1 B  ("A per B")
// We always query ADA/{unit}, so price_ba is "ADA per 1 unit" — exactly the
// token's ADA spot price. (price_ab would be "unit per ADA", the reciprocal.)
// rawAdaUsd() exploits the same shape against the ADA/USDM pair to read ADA's
// USD price on-chain without any centralized oracle.
//
// The X-Partner-Id header (config.sources.dexhunter.partnerId) is only required
// for the swap/estimate + order-building endpoints. Price reads work without it,
// but if a caller wants the partner-gated estimate path and no id is configured,
// the relevant function returns { available: false } so the module can degrade
// to a clean 503 instead of crashing.
//
// Adapters stay "dumb": fetch + normalize shape. Caching / fallback policy lives
// in the module (src/modules/token.js).

import { fetchJSON } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'dexhunter';

// DexHunter expects "" (empty string) as the unit for ADA/lovelace in its
// token-pair paths. Our service uses the canonical "lovelace" unit, so map it.
function toDexHunterUnit(unit) {
  return unit === 'lovelace' || unit === '' ? '' : unit;
}

function buildHeaders() {
  const { partnerId } = config.sources.dexhunter;
  return partnerId ? { 'X-Partner-Id': partnerId } : {};
}

// Low-level: fetch the raw averagePrice payload for a pair, tolerating the
// "illiquid pair" errors DexHunter returns (400/500) as a simple null.
async function rawAveragePrice(tokenA, tokenB) {
  const url = `${config.sources.dexhunter.base}/swap/averagePrice/${encodeURIComponent(toDexHunterUnit(tokenA))}/${encodeURIComponent(toDexHunterUnit(tokenB))}`;
  try {
    const data = await fetchJSON(url, { source: SOURCE, headers: buildHeaders(), retries: 1 });
    return data && (typeof data.price_ab === 'number' || typeof data.price_ba === 'number') ? data : null;
  } catch (err) {
    // A 400/500 here means "no routable pair", not a hard outage — return null so
    // the module can try another source rather than 502-ing the whole request.
    if ([400, 404, 502, 504].includes(err.status)) return null;
    throw err;
  }
}

/**
 * Aggregate average price of `unit` denominated in ADA.
 *
 * We query /swap/averagePrice/ADA/{unit}; `price_ba` ("ADA per 1 unit") is the
 * token's ADA spot price and `price_ab` its reciprocal (unit per ADA).
 *
 * @param {string} unit - policyId+hexAssetName, or "lovelace"
 * @returns {Promise<{adaPerToken:number, tokenPerAda:number, source:string}|null>}
 *          null when the pair has no routable liquidity.
 */
export async function averagePriceInAda(unit) {
  if (unit === 'lovelace') {
    // ADA priced in ADA is 1 by definition.
    return { adaPerToken: 1, tokenPerAda: 1, source: SOURCE };
  }
  const data = await rawAveragePrice('ADA', unit);
  if (!data || typeof data.price_ba !== 'number' || data.price_ba <= 0) return null;
  return { adaPerToken: data.price_ba, tokenPerAda: data.price_ab, source: SOURCE };
}

/**
 * ADA's USD price, derived on-chain from the ADA/{stablecoin} pair. For
 * ADA/USDM, `price_ab` ("USDM per 1 ADA") is ADA's price in ≈1-USD units.
 * @param {string} stableUnit - the stablecoin's unit (≈ 1 USD)
 * @returns {Promise<number|null>}
 */
export async function rawAdaUsd(stableUnit) {
  const data = await rawAveragePrice('ADA', stableUnit);
  if (!data || typeof data.price_ab !== 'number' || data.price_ab <= 0) return null;
  return data.price_ab;
}

/**
 * Partner-gated swap estimate. Only usable when a partnerId is configured;
 * otherwise returns { available:false } so the module can answer 503 cleanly.
 * Kept as a thin passthrough for callers that want a routed quote rather than
 * the aggregate average price.
 *
 * @param {{ tokenIn:string, tokenOut:string, amountIn:number, slippage?:number }} p
 */
export async function estimateSwap({ tokenIn, tokenOut, amountIn, slippage = 5 }) {
  if (!config.sources.dexhunter.partnerId) return { available: false, source: SOURCE };
  const url = `${config.sources.dexhunter.base}/swap/estimate`;
  const body = {
    amount_in: amountIn,
    token_in: toDexHunterUnit(tokenIn),
    token_out: toDexHunterUnit(tokenOut),
    slippage,
    blacklisted_dexes: [],
  };
  const data = await fetchJSON(url, { method: 'POST', body, source: SOURCE, headers: buildHeaders(), retries: 1 });
  return { available: true, estimate: data, source: SOURCE };
}

export default { averagePriceInAda, estimateSwap };
