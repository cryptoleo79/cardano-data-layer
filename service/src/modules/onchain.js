// ON-CHAIN PROXY module — token holders, supply, and metadata.
//
// Routes:
//   GET /token/holders?unit=   holder count + top-N holders
//   GET /token/supply?unit=    total / circulating supply
//   GET /token/metadata?unit=  ticker / name / decimals / logo / url / description
//
// Source strategy:
//   holders  → Koios asset_addresses, fall back to Blockfrost addresses.
//   supply   → Koios asset_info (total_supply), fall back to Blockfrost quantity.
//   metadata → CIP-26 registry, fall back to on-chain (Koios registry/mint
//              metadata, then Blockfrost).
//
// Conventions (BUILD_CONTRACT.md):
//   - Every body carries `source` and `as_of` (ISO).
//   - Unknown values → null + a `note`, never a guess.
//   - If a needed key is missing and no fallback works → 503 source_unavailable.
//   - Large holder lists are paged with a page cap; if capped we report
//     `holder_count_is_lower_bound: true`.

import * as koios from '../sources/koios.js';
import * as blockfrost from '../sources/blockfrost.js';
import * as cip26 from '../sources/cip26.js';
import { config } from '../config.js';
import { UpstreamError } from '../http.js';
import { dq } from '../lib/envelope.js';

// Wrap a handler so every response carries the data-quality envelope (Stream H)
// without rewriting each return site. confidence drops to 'low' on errors.
const withDq = (handler, meta) => async (a) => {
  const r = await handler(a);
  return { ...r, body: dq(r.body, { ...meta, confidence: r.status >= 400 ? 'low' : (meta.confidence || 'high') }) };
};

// ---- tunables ----
const TOP_N = 20;            // how many holders to return in the response
const KOIOS_PAGE = 1000;     // Koios asset_addresses rows per page
const BF_PAGE = 100;         // Blockfrost rows per page (max 100)
const MAX_PAGES = 10;        // hard cap on pages fetched (cost / latency guard)

const nowIso = () => new Date().toISOString();

/**
 * Parse a `unit` (policyId + hexAssetName) into its parts.
 * Policy id is always the first 56 hex chars; the remainder is the asset name.
 * @returns {{unit, policy, nameHex}}
 * @throws {Error & {status:400}} on a malformed unit.
 */
function parseUnit(unit) {
  if (!unit || typeof unit !== 'string') {
    throw Object.assign(new Error('missing required query param: unit'), { status: 400 });
  }
  const u = unit.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(u) || u.length < 56) {
    throw Object.assign(new Error('unit must be hex of policyId(56)+assetName'), { status: 400 });
  }
  return { unit: u, policy: u.slice(0, 56), nameHex: u.slice(56) };
}

/** Wrap an upstream call so it never throws; returns { ok, value } or { ok:false, err }. */
async function tryUpstream(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

// ---------------------------------------------------------------------------
// GET /token/holders
// ---------------------------------------------------------------------------
async function holdersHandler({ query, ctx }) {
  const { unit, policy, nameHex } = parseUnit(query.unit);
  const cacheKey = `onchain:holders:${unit}`;

  return ctx.cache.getOrSet(cacheKey, config.cache.holders, async () => {
    // --- primary: Koios ---
    const koiosRes = await tryUpstream(() => collectKoiosHolders(policy, nameHex));
    if (koiosRes.ok && koiosRes.value.holders.length > 0) {
      return shapeHolders(unit, 'koios', koiosRes.value);
    }

    // --- fallback: Blockfrost ---
    if (blockfrost.isConfigured()) {
      const bfRes = await tryUpstream(() => collectBlockfrostHolders(unit));
      if (bfRes.ok && bfRes.value.holders.length > 0) {
        return shapeHolders(unit, 'blockfrost', bfRes.value);
      }
    }

    // --- nothing worked ---
    const koiosFailed = !koiosRes.ok;
    const source = koiosFailed && !blockfrost.isConfigured() ? 'koios' : 'koios+blockfrost';
    return {
      status: 503,
      body: {
        error: 'source_unavailable',
        source: blockfrost.isConfigured() ? source : 'koios',
        unit,
        as_of: nowIso(),
        note: koiosFailed
          ? `koios error: ${koiosRes.err?.message || 'unreachable'}`
          : 'no holders found on any source',
      },
    };
  });
}

/** Page Koios asset_addresses up to MAX_PAGES; report whether we capped. */
async function collectKoiosHolders(policy, nameHex) {
  const holders = [];
  let capped = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await koios.assetAddresses(policy, nameHex, {
      limit: KOIOS_PAGE,
      offset: page * KOIOS_PAGE,
    });
    holders.push(...rows);
    if (rows.length < KOIOS_PAGE) break;       // last page
    if (page === MAX_PAGES - 1) capped = true;  // hit the cap with a full page
  }
  return { holders, capped };
}

/** Page Blockfrost addresses up to MAX_PAGES; report whether we capped. */
async function collectBlockfrostHolders(unit) {
  const holders = [];
  let capped = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const rows = await blockfrost.assetAddresses(unit, { page: i + 1, count: BF_PAGE });
    if (rows.available === false) break; // not configured (shouldn't reach here)
    holders.push(...rows);
    if (rows.length < BF_PAGE) break;
    if (i === MAX_PAGES - 1) capped = true;
  }
  return { holders, capped };
}

/** Build the holders response body from a collected holder set. */
function shapeHolders(unit, source, { holders, capped }) {
  // Sort by quantity descending (BigInt-safe) and slice the top N.
  const sorted = [...holders].sort((a, b) => {
    const qa = safeBig(a.quantity);
    const qb = safeBig(b.quantity);
    return qa > qb ? -1 : qa < qb ? 1 : 0;
  });
  const top = sorted.slice(0, TOP_N).map((h) => ({ address: h.address, quantity: h.quantity }));
  return {
    status: 200,
    body: {
      unit,
      source,
      as_of: nowIso(),
      holder_count: holders.length,
      holder_count_is_lower_bound: capped,
      top_n: top.length,
      top_holders: top,
      ...(capped
        ? { note: `holder list capped at ${MAX_PAGES} pages; counts are a lower bound` }
        : {}),
    },
  };
}

function safeBig(v) {
  try { return BigInt(v ?? 0); } catch { return 0n; }
}

// ---------------------------------------------------------------------------
// GET /token/supply
// ---------------------------------------------------------------------------
async function supplyHandler({ query, ctx }) {
  const { unit, policy, nameHex } = parseUnit(query.unit);
  const cacheKey = `onchain:supply:${unit}`;

  return ctx.cache.getOrSet(cacheKey, config.cache.supply, async () => {
    // --- primary: Koios asset_info ---
    const koiosRes = await tryUpstream(() => koios.assetInfo(policy, nameHex));
    if (koiosRes.ok && koiosRes.value?.total_supply != null) {
      const decimals = registryDecimals(koiosRes.value);
      return {
        status: 200,
        body: {
          unit,
          source: 'koios',
          as_of: nowIso(),
          total_supply: String(koiosRes.value.total_supply),
          // On-chain there is no separate "circulating" figure; total is the
          // minted-minus-burned supply. We surface it under both keys, flagged.
          circulating_supply: String(koiosRes.value.total_supply),
          decimals,
          mint_count: koiosRes.value.mint_cnt ?? null,
          burn_count: koiosRes.value.burn_cnt ?? null,
          note: 'circulating_supply equals on-chain total (minted − burned); excludes treasury/locked tokens which are not knowable on-chain',
        },
      };
    }

    // --- fallback: Blockfrost ---
    if (blockfrost.isConfigured()) {
      const bfRes = await tryUpstream(() => blockfrost.asset(unit));
      if (bfRes.ok && bfRes.value?.available && bfRes.value.totalSupply != null) {
        return {
          status: 200,
          body: {
            unit,
            source: 'blockfrost',
            as_of: nowIso(),
            total_supply: bfRes.value.totalSupply,
            circulating_supply: bfRes.value.totalSupply,
            decimals: bfRes.value.registryMetadata?.decimals ?? null,
            note: 'circulating_supply equals on-chain total; excludes treasury/locked tokens',
          },
        };
      }
    }

    return {
      status: 503,
      body: {
        error: 'source_unavailable',
        source: blockfrost.isConfigured() ? 'koios+blockfrost' : 'koios',
        unit,
        as_of: nowIso(),
        note: koiosRes.ok ? 'asset not found' : `koios error: ${koiosRes.err?.message || 'unreachable'}`,
      },
    };
  });
}

/** Decimals from Koios token_registry_metadata, if present. */
function registryDecimals(info) {
  const d = info?.token_registry_metadata?.decimals;
  return d != null ? Number(d) : null;
}

// ---------------------------------------------------------------------------
// GET /token/metadata
// ---------------------------------------------------------------------------
async function metadataHandler({ query, ctx }) {
  const { unit, policy, nameHex } = parseUnit(query.unit);
  const cacheKey = `onchain:metadata:${unit}`;

  return ctx.cache.getOrSet(cacheKey, config.cache.metadata, async () => {
    // --- primary: CIP-26 registry ---
    const cipRes = await tryUpstream(() => cip26.metadata(unit));
    if (cipRes.ok && cipRes.value) {
      return shapeMetadata(unit, 'cip26', cipRes.value);
    }

    // --- fallback 1: Koios (off-chain registry mirror + on-chain mint metadata) ---
    const koiosRes = await tryUpstream(() => koios.assetInfo(policy, nameHex));
    if (koiosRes.ok && koiosRes.value) {
      const md = metadataFromKoios(koiosRes.value);
      if (md) return shapeMetadata(unit, 'koios', md);
    }

    // --- fallback 2: Blockfrost ---
    if (blockfrost.isConfigured()) {
      const bfRes = await tryUpstream(() => blockfrost.asset(unit));
      if (bfRes.ok && bfRes.value?.available) {
        const md = metadataFromBlockfrost(bfRes.value);
        if (md) return shapeMetadata(unit, 'blockfrost', md);
      }
    }

    // --- exhausted sources ---
    // Distinguish "no metadata registered" (200 with nulls) from "all sources
    // down" (503). If CIP-26 answered cleanly with null and Koios was reachable
    // but had no metadata, this asset simply has none.
    const cipReachable = cipRes.ok;
    const koiosReachable = koiosRes.ok;
    if (cipReachable || koiosReachable) {
      return {
        status: 200,
        body: {
          unit,
          source: cipReachable ? 'cip26' : 'koios',
          as_of: nowIso(),
          ticker: null, name: null, decimals: null, logo: null, url: null, description: null,
          note: 'no off-chain or on-chain metadata found for this asset',
        },
      };
    }
    return {
      status: 503,
      body: {
        error: 'source_unavailable',
        source: 'cip26+koios+blockfrost',
        unit,
        as_of: nowIso(),
        note: `cip26 error: ${cipRes.err?.message || 'unreachable'}`,
      },
    };
  });
}

/** Build the metadata response body from a normalized metadata object. */
function shapeMetadata(unit, source, md) {
  return {
    status: 200,
    body: {
      unit,
      source,
      as_of: nowIso(),
      ticker: md.ticker ?? null,
      name: md.name ?? null,
      decimals: md.decimals != null ? Number(md.decimals) : null,
      logo: md.logo ?? null,
      url: md.url ?? null,
      description: md.description ?? null,
    },
  };
}

/** Extract metadata from a Koios asset_info row (registry first, then mint tx). */
function metadataFromKoios(info) {
  const reg = info?.token_registry_metadata;
  if (reg && (reg.name || reg.ticker || reg.logo || reg.url || reg.description)) {
    return {
      name: reg.name ?? null,
      ticker: reg.ticker ?? null,
      decimals: reg.decimals ?? null,
      logo: reg.logo ?? null,
      url: reg.url ?? null,
      description: reg.description ?? null,
    };
  }
  // Fall back to CIP-25-style on-chain mint metadata (label 721).
  const mint = info?.minting_tx_metadata?.['721'];
  if (mint && info.policy_id) {
    const byPolicy = mint[info.policy_id];
    const key = info.asset_name_ascii ?? info.asset_name;
    const entry = byPolicy && (byPolicy[key] ?? Object.values(byPolicy)[0]);
    if (entry) {
      return {
        name: entry.name ?? null,
        ticker: entry.symbol ?? entry.ticker ?? null,
        decimals: entry.decimals ?? null,
        logo: entry.image ?? null,
        url: entry.url ?? null,
        description: entry.description ?? null,
      };
    }
  }
  return null;
}

/** Extract metadata from a normalized Blockfrost asset record. */
function metadataFromBlockfrost(a) {
  const reg = a.registryMetadata;
  if (reg && (reg.name || reg.ticker || reg.logo || reg.url || reg.description)) {
    return {
      name: reg.name ?? null,
      ticker: reg.ticker ?? null,
      decimals: reg.decimals ?? null,
      logo: reg.logo ?? null,
      url: reg.url ?? null,
      description: reg.description ?? null,
    };
  }
  const on = a.onchainMetadata;
  if (on) {
    return {
      name: on.name ?? null,
      ticker: on.symbol ?? on.ticker ?? null,
      decimals: on.decimals ?? null,
      logo: on.image ?? null,
      url: on.url ?? null,
      description: on.description ?? null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// module export
// ---------------------------------------------------------------------------
export default {
  name: 'onchain',
  routes: [
    { method: 'GET', path: '/token/holders', handler: withDq(holdersHandler, { source: 'koios+blockfrost', authority_class: 'A', refresh: '~10m', provenance: 'on-chain holder set (Koios asset_addresses → Blockfrost)' }), meta: { desc: 'holder count + top holders (Koios→Blockfrost)' } },
    { method: 'GET', path: '/token/supply', handler: withDq(supplyHandler, { source: 'koios+blockfrost', authority_class: 'A', refresh: '~10m', provenance: 'on-chain supply (Koios asset_info → Blockfrost)' }), meta: { desc: 'total/circulating supply (Koios→Blockfrost)' } },
    { method: 'GET', path: '/token/metadata', handler: withDq(metadataHandler, { source: 'cip26+onchain', authority_class: 'B', refresh: 'hourly', provenance: 'CIP-26 registry → on-chain mint metadata' }), meta: { desc: 'ticker/name/decimals/logo/url (CIP-26→on-chain)' } },
  ],
  // exported for tests
  _internal: { parseUnit, shapeHolders, shapeMetadata, metadataFromKoios },
};

export { holdersHandler, supplyHandler, metadataHandler, parseUnit };
