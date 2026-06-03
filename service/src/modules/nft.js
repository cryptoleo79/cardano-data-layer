// NFT module — collection-level stats and recent sales for a Cardano policy.
//
// Routes:
//   GET /nft/collection/stats?policy=<policyId>   floor / volume / listings / owners / supply
//   GET /nft/collection/sales?policy=<policyId>&page=N   recent trades
//
// Data comes from a single, swappable source interface (see ../sources/opencnft.js).
// The module owns *policy*: input validation, caching, and mapping the source's
// `{ available:false }` markers onto clean HTTP error responses. It never calls
// fetch directly, so the provider can be replaced without touching handlers.
//
// Response conventions (per BUILD_CONTRACT.md):
//   - every body carries `source` and an ISO `as_of`
//   - money is in ADA; `usd` is always null here (no price oracle wired) with a note
//   - unknown values are null with a note, never fabricated
//   - upstream trouble -> 502/503 with an `error` field, server never crashes

import { openCnftSource } from '../sources/opencnft.js';
import { config } from '../config.js';

// The source is injected via the module's closure so tests can swap it for a
// fake. We keep a mutable reference but default to the real OpenCNFT adapter.
let source = openCnftSource;

/** Test seam: replace the underlying NFT source (must match the interface). */
export function _setSource(s) { source = s; }

const USD_NOTE = 'usd unavailable: no fiat price source wired into this service';

/**
 * A Cardano policy id is exactly 28 bytes = 56 lowercase hex chars. We validate
 * loosely (also accept uppercase) to reject obvious garbage before any network
 * call, but stay permissive about future formats.
 */
function validPolicy(policy) {
  return typeof policy === 'string' && /^[0-9a-fA-F]{56}$/.test(policy);
}

/** Build the standard envelope fields shared by every response. */
function envelope() {
  return { source: source.name, as_of: new Date().toISOString() };
}

/**
 * GET /nft/collection/stats?policy=
 * Returns floor (ada+usd), volume (ada), listings, owners, supply.
 */
async function statsHandler({ query, ctx }) {
  const policy = query.policy;
  if (!validPolicy(policy)) {
    return { status: 400, body: { error: 'invalid_policy', note: 'policy must be a 56-char hex policy id', ...envelope() } };
  }

  // Cache per policy. getOrSet serves a stale value on transient errors if one
  // exists; otherwise the source's own graceful marker flows through.
  const key = `nft:stats:${policy}`;
  const stats = await ctx.cache.getOrSet(key, config.cache.nft, () => source.collectionStats(policy));

  if (!stats || stats.available === false) {
    const reason = stats?.reason;
    if (reason === 'not_found') {
      return { status: 404, body: { error: 'collection_not_found', policy, ...envelope() } };
    }
    return { status: 503, body: { error: 'source_unavailable', source: source.name, policy, ...envelope() } };
  }

  return {
    status: 200,
    body: {
      policy,
      floor: { ada: stats.floor_ada, usd: null },
      volume: { ada: stats.volume_ada, usd: null },
      listings: stats.listings,
      owners: stats.owners,
      supply: stats.supply,
      note: USD_NOTE,
      ...envelope(),
    },
  };
}

/**
 * GET /nft/collection/sales?policy=&page=
 * Returns a page of recent sales/trades. Prices in ADA; usd null.
 */
async function salesHandler({ query, ctx }) {
  const policy = query.policy;
  if (!validPolicy(policy)) {
    return { status: 400, body: { error: 'invalid_policy', note: 'policy must be a 56-char hex policy id', ...envelope() } };
  }
  const page = Number.isFinite(Number(query.page)) && Number(query.page) > 0 ? Math.floor(Number(query.page)) : 1;

  const key = `nft:sales:${policy}:${page}`;
  const res = await ctx.cache.getOrSet(key, config.cache.nft, () => source.collectionSales(policy, { page }));

  if (!res || res.available === false) {
    const reason = res?.reason;
    if (reason === 'not_found') {
      return { status: 404, body: { error: 'collection_not_found', policy, ...envelope() } };
    }
    return { status: 503, body: { error: 'source_unavailable', source: source.name, policy, ...envelope() } };
  }

  return {
    status: 200,
    body: {
      policy,
      page: res.page,
      count: res.sales.length,
      // Each sale: prices in ADA, usd null (no oracle). Unknown fields are null.
      sales: res.sales.map((s) => ({ ...s, price: { ada: s.price_ada, usd: null }, price_ada: undefined })),
      note: USD_NOTE,
      ...envelope(),
    },
  };
}

export default {
  name: 'nft',
  routes: [
    { method: 'GET', path: '/nft/collection/stats', handler: statsHandler, meta: { desc: 'NFT collection stats (floor, volume, listings, owners, supply)' } },
    { method: 'GET', path: '/nft/collection/sales', handler: salesHandler, meta: { desc: 'recent NFT collection sales' } },
  ],
};
