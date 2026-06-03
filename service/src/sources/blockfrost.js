// Blockfrost adapter — https://cardano-mainnet.blockfrost.io/api/v0
//
// Blockfrost requires a free project_id (config.sources.blockfrost.projectId),
// sent as the `project_id` header. With no key configured the adapter degrades
// gracefully: every function returns { available: false } instead of throwing,
// so the module can fall back to Koios or answer `source_unavailable`.
//
// API shapes (Blockfrost v0):
//   - GET /assets/{unit}            → { asset, policy_id, asset_name, fingerprint,
//                                        quantity, initial_mint_tx_hash,
//                                        onchain_metadata, metadata, ... }
//                                      `quantity` is the current total supply.
//                                      `metadata` is the CIP-26 registry block
//                                      (name/ticker/decimals/logo/url/description).
//   - GET /assets/{unit}/addresses?page=&count= → [{ address, quantity }, ...]
//                                      Paged, 100 rows/page by default (max 100).
// `unit` = policyId + hexAssetName (concatenated, no separator).

import { fetchJSON, UpstreamError } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'blockfrost';

/** True when a project_id is configured. */
export function isConfigured() {
  return Boolean(config.sources.blockfrost.projectId);
}

function headers() {
  return { project_id: config.sources.blockfrost.projectId };
}

const base = () => config.sources.blockfrost.base.replace(/\/+$/, '');

/**
 * GET /assets/{unit} — metadata + total supply.
 * @param {string} unit policyId+hexAssetName
 * @returns {Promise<{available:false}|object>} normalized asset record, or
 *          { available:false } when no key is configured.
 */
export async function asset(unit) {
  if (!isConfigured()) return { available: false };
  const row = await fetchJSON(`${base()}/assets/${unit}`, {
    headers: headers(),
    source: SOURCE,
    timeoutMs: 12_000,
  });
  if (!row) return null;
  return {
    available: true,
    unit: row.asset ?? unit,
    policyId: row.policy_id ?? null,
    assetNameHex: row.asset_name ?? null,
    fingerprint: row.fingerprint ?? null,
    totalSupply: row.quantity != null ? String(row.quantity) : null,
    // On-chain (CIP-25 NFT-style) metadata and off-chain (CIP-26 registry) metadata.
    onchainMetadata: row.onchain_metadata ?? null,
    registryMetadata: row.metadata ?? null,
  };
}

/**
 * GET /assets/{unit}/addresses — one page of holders.
 * @param {string} unit
 * @param {object} [opts]
 * @param {number} [opts.page=1]   Blockfrost pages are 1-based.
 * @param {number} [opts.count=100] rows per page (max 100).
 * @returns {Promise<{available:false}|Array<{address:string, quantity:string}>>}
 */
export async function assetAddresses(unit, opts = {}) {
  if (!isConfigured()) return { available: false };
  const { page = 1, count = 100 } = opts;
  const qs = new URLSearchParams({ page: String(page), count: String(count), order: 'desc' });
  const rows = await fetchJSON(`${base()}/assets/${unit}/addresses?${qs}`, {
    headers: headers(),
    source: SOURCE,
    timeoutMs: 12_000,
    retries: 1,
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    address: r.address ?? null,
    quantity: r.quantity != null ? String(r.quantity) : null,
  }));
}

export { UpstreamError };
export default { isConfigured, asset, assetAddresses };
