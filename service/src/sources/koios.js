// Koios adapter — https://api.koios.rest/api/v1
//
// Koios is the primary on-chain source. The public tier needs no key
// (5k requests/day, rate limited by IP). If config.sources.koios.token is set,
// we send it as a Bearer token to unlock the paid tier's higher limits.
//
// API shapes (verified against the live v1 API on 2026-06-03 where reachable):
//   - POST /asset_info       body { "_asset_list": [[policy, nameHex], ...] }
//                            → [{ policy_id, asset_name, total_supply,
//                                 token_registry_metadata, minting_tx_metadata, ... }]
//                            (verified 200 OK against SNEK.)
//   - GET  /asset_addresses?_asset_policy=<hex>&_asset_name=<hex>&limit=&offset=
//                            → [{ payment_address, quantity }, ...]
//                            This is the documented v1 shape. Koios paginates with
//                            `limit`/`offset` query params (max 1000 rows/page).
//                            NOTE: from the build host this endpoint was timing out
//                            (large response for popular assets); the code below caps
//                            pages and times out cleanly so the module can fall back
//                            to Blockfrost. The shape is per Koios v1 docs.
//
// Adapters stay dumb: fetch + normalize only. Caching / fallback policy lives in
// the module (src/modules/onchain.js).

import { fetchJSON } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'koios';

/** Common headers — Bearer token only when a paid-tier token is configured. */
function headers() {
  const h = {};
  if (config.sources.koios.token) h.authorization = `Bearer ${config.sources.koios.token}`;
  return h;
}

const base = () => config.sources.koios.base.replace(/\/+$/, '');

/**
 * POST /asset_info for a single asset.
 * @param {string} policy   policy id (56 hex chars)
 * @param {string} nameHex  hex-encoded asset name (may be '')
 * @returns {Promise<object|null>} the asset_info row, or null if unknown.
 */
export async function assetInfo(policy, nameHex) {
  const rows = await fetchJSON(`${base()}/asset_info`, {
    method: 'POST',
    headers: headers(),
    body: { _asset_list: [[policy, nameHex]] },
    source: SOURCE,
    timeoutMs: 12_000,
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

/**
 * GET /asset_addresses — one page of holder address/quantity pairs.
 * @param {string} policy
 * @param {string} nameHex
 * @param {object} [opts]
 * @param {number} [opts.limit=1000]  rows per page (Koios caps at 1000)
 * @param {number} [opts.offset=0]
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<Array<{address:string, quantity:string}>>}
 */
export async function assetAddresses(policy, nameHex, opts = {}) {
  const { limit = 1000, offset = 0, timeoutMs = 15_000 } = opts;
  const qs = new URLSearchParams({
    _asset_policy: policy,
    _asset_name: nameHex,
    limit: String(limit),
    offset: String(offset),
  });
  const rows = await fetchJSON(`${base()}/asset_addresses?${qs}`, {
    headers: headers(),
    source: SOURCE,
    timeoutMs,
    // Holder lists can be large/slow; don't burn the request budget retrying.
    retries: 1,
  });
  if (!Array.isArray(rows)) return [];
  // Normalize: Koios returns { payment_address, quantity }.
  return rows.map((r) => ({
    address: r.payment_address ?? r.address ?? null,
    quantity: r.quantity != null ? String(r.quantity) : null,
  }));
}

/**
 * Convenience: pull the off-chain token registry metadata that Koios attaches to
 * asset_info (mirror of CIP-26). Returns the `token_registry_metadata` object or
 * null. Useful as a free fallback when the CIP-26 server is unreachable.
 * @param {string} policy
 * @param {string} nameHex
 */
export async function assetTokenRegistry(policy, nameHex) {
  const info = await assetInfo(policy, nameHex);
  return info?.token_registry_metadata ?? null;
}

export default { assetInfo, assetAddresses, assetTokenRegistry };
