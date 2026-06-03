// OpenCNFT v2 adapter — the only upstream for the NFT module.
//
// This file is a thin, "dumb" client: it fetches and shapes data, and contains
// no caching/fallback policy (that lives in src/modules/nft.js).
//
// IMPORTANT — swappability:
//   The NFT marketplace data landscape is unstable (jpg.store's public API is
//   already dead; OpenCNFT could follow). So this module exposes a small
//   *interface object* `openCnftSource = { name, collectionStats, collectionSales }`.
//   The nft module depends on that interface shape, never on `fetch` directly.
//   To swap providers later, write another file exporting the same three members
//   and point the module at it — no handler changes needed.
//
// Auth: OpenCNFT v2 takes an optional `X-Api-Key`. Many v2 read endpoints work
//   without a key but are rate-limited. We send the key only if configured, and
//   degrade gracefully (return an `unavailable` shape) on any failure rather
//   than throwing — so a flaky/dead upstream can never crash the server.
//
// Endpoint shapes are coded to the documented OpenCNFT v2 API
// (https://docs.opencnft.io , base https://api.opencnft.io/2). At build time the
// network was unreachable (offline sandbox) so paths could not be live-verified;
// they follow the v2 documentation:
//   GET /collection/{policy}/stats         -> floor/volume/supply/owners/listings (lovelace)
//   GET /collection/{policy}/transactions  -> recent trades (price in lovelace, paged)
// All ADA-denominated values come back from OpenCNFT in lovelace (1 ADA = 1e6).

import { fetchJSON, UpstreamError } from '../http.js';
import { config } from '../config.js';

const LOVELACE = 1_000_000;

/** Trim trailing slash so we can join paths predictably. */
function base() {
  const b = config.sources.opencnft.base || 'https://api.opencnft.io/2';
  return b.replace(/\/+$/, '');
}

/** Build request headers; include the API key only when one is configured. */
function headers() {
  const key = config.sources.opencnft.apiKey;
  return key ? { 'X-Api-Key': key } : {};
}

/** Lovelace -> ADA number (or null if the input is missing/non-numeric). */
function lovelaceToAda(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n / LOVELACE;
}

/** Coerce to a finite number, else null. Never throws. */
function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalized collection statistics for a policy.
 * Returns `{ available:false, reason }` on any upstream failure so the module
 * can answer with a clean 503 instead of crashing.
 *
 * @param {string} policyId 56-hex-char collection policy id
 * @returns {Promise<object>} normalized stats or an unavailable marker
 */
async function collectionStats(policyId) {
  const url = `${base()}/collection/${encodeURIComponent(policyId)}/stats`;
  let raw;
  try {
    raw = await fetchJSON(url, { source: 'opencnft', headers: headers(), timeoutMs: 12_000, retries: 2 });
  } catch (err) {
    // 404 = collection genuinely not found; everything else = upstream trouble.
    const status = err instanceof UpstreamError ? err.status : 502;
    return { available: false, reason: status === 404 ? 'not_found' : 'upstream_error', status };
  }
  if (!raw || typeof raw !== 'object') {
    return { available: false, reason: 'empty_response', status: 502 };
  }

  // OpenCNFT v2 returns ADA amounts in lovelace. Field names per v2 docs; we
  // accept a couple of historical aliases defensively so a minor rename upstream
  // doesn't silently zero a value.
  const floorLovelace = raw.floor_price ?? raw.floor;
  const volumeLovelace = raw.total_volume ?? raw.volume;

  return {
    available: true,
    floor_ada: lovelaceToAda(floorLovelace),
    volume_ada: lovelaceToAda(volumeLovelace),
    listings: num(raw.listings ?? raw.asset_listed ?? raw.total_listings),
    owners: num(raw.owners ?? raw.total_owners),
    supply: num(raw.asset_minted ?? raw.supply ?? raw.total_supply),
  };
}

/**
 * Normalized recent sales/trades for a policy (one page).
 * Returns `{ available:false, reason }` on any upstream failure.
 *
 * @param {string} policyId
 * @param {object} [opts]
 * @param {number} [opts.page=1] 1-based page index passed through to OpenCNFT
 * @returns {Promise<object>} `{ available, page, sales[] }` or unavailable marker
 */
async function collectionSales(policyId, { page = 1 } = {}) {
  const p = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  const url = `${base()}/collection/${encodeURIComponent(policyId)}/transactions?page=${p}`;
  let raw;
  try {
    raw = await fetchJSON(url, { source: 'opencnft', headers: headers(), timeoutMs: 12_000, retries: 2 });
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 502;
    return { available: false, reason: status === 404 ? 'not_found' : 'upstream_error', status };
  }

  // v2 returns either a bare array or an envelope { transactions: [...] } /
  // { items: [...] } depending on endpoint version; handle all three.
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.transactions)
      ? raw.transactions
      : Array.isArray(raw?.items)
        ? raw.items
        : [];

  const sales = list.map((t) => ({
    // unit = policyId + hex(assetName); asset name decoded if upstream gives it
    unit: t.unit ?? t.asset ?? null,
    name: t.name ?? t.asset_name ?? null,
    price_ada: lovelaceToAda(t.price ?? t.sold_for ?? t.amount),
    marketplace: t.marketplace ?? t.market ?? null,
    tx_hash: t.tx_hash ?? t.hash ?? null,
    // OpenCNFT timestamps are unix ms; normalize to ISO, null if absent/bad.
    sold_at: toIso(t.sold_at ?? t.timestamp ?? t.confirmed_at),
  }));

  return { available: true, page: p, sales };
}

/** Convert a unix-ms (number or numeric string) to ISO; null on bad input. */
function toIso(ms) {
  const n = num(ms);
  if (n == null) return null;
  // Heuristic: treat <1e12 as seconds, otherwise milliseconds.
  const millis = n < 1e12 ? n * 1000 : n;
  const d = new Date(millis);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The swappable NFT source interface. The module imports THIS object and only
 * uses `.name`, `.collectionStats`, `.collectionSales`. A replacement provider
 * just needs to export the same shape.
 */
export const openCnftSource = {
  name: 'opencnft',
  collectionStats,
  collectionSales,
};

export default openCnftSource;
