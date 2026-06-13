// Token market module.
//
// Routes:
//   GET /token/price?unit=            spot price (ADA + USD), confidence, source
//   GET /token/ohlcv?unit=&interval=&limit=   candles from the `ohlcv` table
//   GET /token/mcap?unit=             price x on-chain supply
//   GET /tokens/top?by=&limit=        ranking over the tracked/known set
//   GET /token/search?q=              search tracked/seed tokens + DexHunter
//   GET /token/list                   known tokens (seed set + ohlcv units)
//   GET /token/:id                    MERGED detail (metadata+supply+price+holders)
//
// Every body is wrapped in the data-quality envelope (lib/envelope.js dq()):
// authority_class B for CIP-26/Koios (metadata/supply/holders), C for DexHunter
// (price); refresh '~5m' for ohlcv, 'on-demand' for proxied live reads.
//
// Conventions (see BUILD_CONTRACT.md): every body carries `source` + `as_of`
// (ISO). Money carries `ada` and `usd` (usd null if not derivable). Derived /
// illiquid values carry `confidence:'low'`. Unknowns are null + a `note`; we
// never fabricate.
//
// Price strategy: DexHunter (aggregate average price across DEXes) is the
// primary on-chain source; Minswap is a cross-check / fallback. USD is derived
// purely on-chain from the ADA/stablecoin pair (no centralized oracle), so a
// USD figure only appears when that pair is routable.

import { readFileSync } from 'node:fs';
import { db, run, get, all } from '../db.js';
import { config } from '../config.js';
import { fetchJSON, UpstreamError } from '../http.js';
import { dq } from '../lib/envelope.js';
import * as dexhunter from '../sources/dexhunter.js';
import * as minswap from '../sources/minswap.js';
import * as geckoterminal from '../sources/geckoterminal.js';
import * as cip26 from '../sources/cip26.js';
import * as koios from '../sources/koios.js';

const nowIso = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);

// USDM stablecoin unit. Used only to derive ADA's USD value on-chain: the
// ADA/USDM average price is, by construction, ADA's price in (≈1 USD) USDM.
const USDM_UNIT = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d';

// Tracked token universe so /tokens/top + the poller have a real set to rank.
// Loaded from seed/tracked-tokens.json (Koios-verified units); falls back to a
// minimal hardcoded set if the file is absent. Coverage is still a curated set,
// not the whole ecosystem — surfaced honestly as `coverage: 'partial'`.
const FALLBACK_SEED_UNITS = [
  { unit: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e', ticker: 'MIN', name: 'Minswap' },
  { unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', ticker: 'SNEK', name: 'SNEK' },
  { unit: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59', ticker: 'HOSKY', name: 'Hosky Token' },
];
function loadSeedUnits() {
  try {
    const p = new URL('../../seed/tracked-tokens.json', import.meta.url);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const toks = (j.tokens || []).filter((t) => t.unit && /^[0-9a-f]+$/.test(t.unit));
    return toks.length ? toks.map((t) => ({ unit: t.unit, ticker: t.ticker, name: t.name })) : FALLBACK_SEED_UNITS;
  } catch { return FALLBACK_SEED_UNITS; }
}
const SEED_UNITS = loadSeedUnits();

const VALID_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const INTERVAL_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

// ---------------------------------------------------------------------------
// init: create the OHLCV table the poller fills and the price routes read.
// ---------------------------------------------------------------------------
export async function init(ctx) {
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      unit     TEXT    NOT NULL,
      ts       INTEGER NOT NULL,   -- epoch seconds (candle open time)
      interval TEXT    NOT NULL,   -- '1m','1h','1d', or 'raw' for poller points
      o        REAL,
      h        REAL,
      l        REAL,
      c        REAL,
      v        REAL,               -- volume (ADA), null when unknown
      source   TEXT,
      PRIMARY KEY (unit, interval, ts)
    );
  `);
  ctx.db.exec('CREATE INDEX IF NOT EXISTS idx_ohlcv_unit_interval_ts ON ohlcv (unit, interval, ts);');

  // token_market: per-token market snapshot collected by the poller from
  // GeckoTerminal. This is what /tokens/top and /token/mcap rank/read so the
  // request path is a fast local read, never a live multi-page upstream sweep.
  // mcap_usd is circulating (CoinGecko); fdv_usd is price x total supply — we
  // keep both so the ranking can prefer circulating and fall back to fdv
  // honestly (flagged via mcap_basis). All money is USD as the source reports
  // it; ADA columns are derived at read time from the on-chain ADA/USD rate.
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS token_market (
      unit          TEXT PRIMARY KEY,
      symbol        TEXT,
      price_usd     REAL,
      mcap_usd      REAL,    -- circulating market cap (null when untracked)
      fdv_usd       REAL,    -- fully diluted (price x total supply)
      liquidity_usd REAL,    -- aggregate DEX pool reserves
      volume24h_usd REAL,    -- 24h traded volume
      total_supply  REAL,
      decimals      INTEGER,
      source        TEXT,
      as_of         INTEGER  -- epoch seconds of last refresh
    );
  `);
  ctx.log?.('token: ohlcv + token_market tables ready');
}

// ---------------------------------------------------------------------------
// Shared price helpers
// ---------------------------------------------------------------------------

/**
 * Derive ADA's USD price on-chain via the ADA/USDM pair. Cached. Returns null
 * if the pair isn't routable (we never substitute a centralized oracle to avoid
 * fabricating a number the rest of the stack can't reproduce on-chain).
 */
async function adaUsd(ctx) {
  return ctx.cache.getOrSet('token:ada_usd', config.cache.price, async () => {
    // ADA/USDM price_ab = USDM (~USD) per 1 ADA = ADA's USD price (on-chain).
    const usd = await dexhunter.rawAdaUsd(USDM_UNIT);
    return usd && usd > 0 ? usd : null;
  });
}

/**
 * Resolve a token's spot price in ADA across sources, with a cross-check.
 * Returns { ada, usd, confidence, sources, note }.
 */
async function resolvePrice(ctx, unit) {
  const usdPerAda = await adaUsd(ctx).catch(() => null);

  if (unit === 'lovelace') {
    return {
      ada: 1,
      usd: usdPerAda,
      confidence: 'high',
      sources: ['definition'],
      note: usdPerAda == null ? 'usd unavailable: ADA/USDM pair not routable' : undefined,
    };
  }

  // Query both on-chain sources; tolerate either being unavailable.
  const [dh, ms] = await Promise.all([
    dexhunter.averagePriceInAda(unit).catch(() => null),
    minswap.averagePriceInAda(unit).catch(() => null),
  ]);

  const candidates = [];
  if (dh && dh.adaPerToken > 0) candidates.push({ src: 'dexhunter', ada: dh.adaPerToken });
  if (ms && ms.adaPerToken > 0) candidates.push({ src: 'minswap', ada: ms.adaPerToken });

  if (candidates.length === 0) {
    return { ada: null, usd: null, confidence: 'low', sources: [], note: 'no routable liquidity on tracked DEX sources' };
  }

  // Primary = DexHunter if present (aggregate across DEXes), else whatever we got.
  const primary = candidates.find((c) => c.src === 'dexhunter') || candidates[0];
  const ada = primary.ada;
  const usd = usdPerAda != null ? ada * usdPerAda : null;

  // Confidence: high only when two independent sources agree within 5%.
  let confidence = 'low';
  let note;
  if (candidates.length >= 2) {
    const [a, b] = candidates.map((c) => c.ada);
    const diff = Math.abs(a - b) / ((a + b) / 2);
    if (diff <= 0.05) confidence = 'high';
    else note = `sources diverge ${(diff * 100).toFixed(1)}% (dexhunter vs minswap); using primary`;
  } else {
    note = 'single-source price; not cross-checked';
  }
  if (usd == null) note = [note, 'usd unavailable: ADA/USDM pair not routable'].filter(Boolean).join('; ');

  return { ada, usd, confidence, sources: candidates.map((c) => c.src), note };
}

/**
 * Fetch on-chain total supply + decimals for a unit directly from Koios.
 * Inlined here (rather than depending on onchain.js) to keep modules decoupled.
 * Returns { supply: bigint-as-number-of-whole-tokens|null, decimals, raw }.
 */
async function koiosSupply(ctx, unit) {
  if (unit === 'lovelace') {
    // ADA total supply is a protocol constant (max 45e9); circulating differs.
    // We don't have a clean on-chain "circulating" read here, so report null.
    return { supply: null, decimals: 6, rawSupply: null, note: 'ADA supply not derived here' };
  }
  const policyId = unit.slice(0, 56);
  const assetName = unit.slice(56); // hex; may be empty
  return ctx.cache.getOrSet(`token:supply:${unit}`, config.cache.supply, async () => {
    const url = `${config.sources.koios.base}/asset_info`;
    const headers = config.sources.koios.token ? { authorization: `Bearer ${config.sources.koios.token}` } : {};
    const rows = await fetchJSON(url, {
      method: 'POST',
      body: { _asset_list: [[policyId, assetName]] },
      headers,
      source: 'koios',
      retries: 1,
    });
    const rec = Array.isArray(rows) ? rows[0] : null;
    if (!rec || rec.total_supply == null) return { supply: null, decimals: null, rawSupply: null };
    const decimals = Number((rec.token_registry_metadata || {}).decimals ?? 0) || 0;
    const rawSupply = Number(rec.total_supply);
    const supply = Number.isFinite(rawSupply) ? rawSupply / 10 ** decimals : null;
    return { supply, decimals, rawSupply: rec.total_supply };
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function requireUnit(query) {
  const unit = (query.unit || '').trim();
  if (!unit) throw new UpstreamError('missing required query param: unit', { status: 400, source: 'token' });
  // lovelace is the one non-hex special case; otherwise expect policyId(56) + hex name.
  if (unit !== 'lovelace' && !/^[0-9a-fA-F]{56,}$/.test(unit)) {
    throw new UpstreamError('invalid unit: expected "lovelace" or policyId+hexAssetName', { status: 400, source: 'token' });
  }
  return unit.toLowerCase() === 'lovelace' ? 'lovelace' : unit.toLowerCase();
}

/** GET /token/price?unit= */
async function priceHandler({ query, ctx }) {
  const unit = requireUnit(query);
  const p = await ctx.cache.getOrSet(`token:price:${unit}`, config.cache.price, () => resolvePrice(ctx, unit));
  const source = p.sources.length ? p.sources.join('+') : 'none';
  return {
    status: 200,
    body: dq({
      unit,
      price: { ada: p.ada, usd: p.usd },
      confidence: p.confidence,
      source,
      as_of: nowIso(),
      ...(p.note ? { note: p.note } : {}),
    }, {
      source,
      authority_class: 'C', // on-chain DEX spot price (at-risk platform aggregation)
      refresh: 'on-demand',
      confidence: p.confidence,
      provenance: 'DexHunter aggregate average price (Minswap cross-check); USD derived on-chain via ADA/USDM',
    }),
  };
}

/** GET /token/ohlcv?unit=&interval=1h&limit= */
async function ohlcvHandler({ query, ctx }) {
  const unit = requireUnit(query);
  const interval = (query.interval || '1h').trim();
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 100, 1), 1000);

  // Accept the documented intervals plus 'raw' (what the poller writes today).
  if (interval !== 'raw' && !VALID_INTERVALS.has(interval)) {
    throw new UpstreamError(`invalid interval; expected one of ${[...VALID_INTERVALS].join(',')} or raw`, { status: 400, source: 'token' });
  }

  // 'raw' returns the poller's price ticks verbatim. Named intervals are
  // aggregated on read by bucketing the persisted raw ticks into o/h/l/c
  // candles — so collected history becomes real candles with no separate
  // aggregation job. Volume stays null (we don't yet read per-interval on-chain
  // volume); o=first tick, h=max, l=min, c=last tick in each bucket.
  if (interval === 'raw') {
    const rows = all(
      'SELECT ts, o, h, l, c, v, source FROM ohlcv WHERE unit = ? AND interval = ? ORDER BY ts DESC LIMIT ?',
      unit, 'raw', limit,
    );
    const candles = rows.reverse().map((r) => ({
      ts: r.ts, time: new Date(r.ts * 1000).toISOString(),
      o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, source: r.source,
    }));
    const note = candles.length === 0
      ? 'no raw points yet: run the ohlcv poller (npm run poller, or the --once cron) to start collecting history'
      : undefined;
    const source = candles.length ? [...new Set(candles.map((c) => c.source))].join('+') : 'ohlcv-table';
    return { status: 200, body: dq({ unit, interval, candles, count: candles.length, source,
      as_of: nowIso(), ...(note ? { note } : {}) }, {
      source, authority_class: 'C', refresh: '~5m', confidence: 'medium',
      provenance: 'ohlcv table — DexHunter price ticks collected by the CDL poller',
    }) };
  }

  const sec = INTERVAL_SECONDS[interval];
  // Pull raw ticks ascending and bucket them. (Bounded by limit*bucket window.)
  const raw = all(
    'SELECT ts, c, v, source FROM ohlcv WHERE unit = ? AND interval = ? ORDER BY ts ASC',
    unit, 'raw',
  );
  const buckets = new Map(); // bucketTs -> {o,h,l,c,v,sources:Set,first,last}
  for (const r of raw) {
    const b = Math.floor(r.ts / sec) * sec;
    let k = buckets.get(b);
    if (!k) { k = { o: r.c, h: r.c, l: r.c, c: r.c, v: null, src: new Set(), firstTs: r.ts, lastTs: r.ts }; buckets.set(b, k); }
    if (r.ts <= k.firstTs) { k.o = r.c; k.firstTs = r.ts; }
    if (r.ts >= k.lastTs) { k.c = r.c; k.lastTs = r.ts; }
    if (r.c > k.h) k.h = r.c;
    if (r.c < k.l) k.l = r.c;
    if (r.v != null) k.v = (k.v ?? 0) + r.v;
    if (r.source) k.src.add(r.source);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-limit);
  const candles = ordered.map(([b, k]) => ({
    ts: b, time: new Date(b * 1000).toISOString(),
    o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, source: [...k.src].join('+') || null,
  }));

  let note = 'candles aggregated on read from raw price ticks; volume is null (per-interval on-chain volume not yet captured)';
  if (candles.length === 0) {
    const rawCount = get('SELECT COUNT(*) AS n FROM ohlcv WHERE unit = ?', unit)?.n || 0;
    note = rawCount === 0
      ? 'no candles yet: run the ohlcv poller (npm run poller, or the --once cron) with this unit tracked'
      : `${rawCount} raw point(s) exist but none fell into the requested window`;
  }

  const source = candles.length ? [...new Set(candles.flatMap((c) => (c.source || '').split('+')).filter(Boolean))].join('+') : 'ohlcv-table';
  return {
    status: 200,
    body: dq({
      unit, interval, candles, count: candles.length,
      source,
      as_of: nowIso(),
      note,
    }, {
      source, authority_class: 'C', refresh: '~5m', confidence: 'medium',
      provenance: 'ohlcv table — DexHunter price ticks collected by the CDL poller, bucketed on read',
    }),
  };
}

/** GET /token/mcap?unit=
 *  Market cap, preferring CIRCULATING (GeckoTerminal/CoinGecko). Falls back to
 *  FDV (price x GeckoTerminal total supply), then to price x Koios total supply
 *  — each fallback flagged via `supply_basis` with a downgraded confidence, so a
 *  mint-cap artifact (e.g. Djed's 1e12 total_supply) can never masquerade as a
 *  real circulating market cap the way it did before. */
async function mcapHandler({ query, ctx }) {
  const unit = requireUnit(query);
  const usdPerAda = await adaUsd(ctx).catch(() => null);
  const gt = await ctx.cache.getOrSet(`token:gt:${unit}`, config.cache.price, () => geckoterminal.tokenMarket(unit)).catch(() => null);

  const usdToAda = (u) => (u != null && usdPerAda ? u / usdPerAda : null);

  // 1) Circulating market cap straight from GeckoTerminal (the honest figure).
  if (gt && gt.mcapUsd != null) {
    const priceUsd = gt.priceUsd;
    return mcapBody(unit, {
      priceUsd, priceAda: usdToAda(priceUsd),
      supply: priceUsd ? gt.mcapUsd / priceUsd : null, decimals: gt.decimals,
      mcapUsd: gt.mcapUsd, mcapAda: usdToAda(gt.mcapUsd),
      supply_basis: 'circulating', confidence: 'high',
      source: 'geckoterminal',
      provenance: 'circulating market cap from GeckoTerminal (CoinGecko circulating supply); ADA derived from on-chain ADA/USD',
    });
  }

  // 2) FDV from GeckoTerminal (price x total supply) — flagged, not circulating.
  if (gt && gt.fdvUsd != null) {
    const priceUsd = gt.priceUsd;
    // GeckoTerminal total_supply is raw (undivided); normalize to whole tokens
    // so `supply` is consistent with the circulating branch.
    const wholeSupply = gt.totalSupply != null && gt.decimals != null
      ? gt.totalSupply / 10 ** gt.decimals
      : (priceUsd ? gt.fdvUsd / priceUsd : gt.totalSupply);
    return mcapBody(unit, {
      priceUsd, priceAda: usdToAda(priceUsd),
      supply: wholeSupply, decimals: gt.decimals,
      mcapUsd: gt.fdvUsd, mcapAda: usdToAda(gt.fdvUsd),
      supply_basis: 'fdv', confidence: 'medium',
      source: 'geckoterminal',
      note: 'circulating supply unavailable; reporting fully-diluted valuation (price x total supply)',
      provenance: 'FDV from GeckoTerminal (price x total supply); circulating supply not available',
    });
  }

  // 3) Last resort: price (DexHunter) x Koios total supply. total_supply can be
  //    a mint cap, so this is flagged supply_basis:'total' at low confidence.
  const [price, sup] = await Promise.all([
    ctx.cache.getOrSet(`token:price:${unit}`, config.cache.price, () => resolvePrice(ctx, unit)),
    koiosSupply(ctx, unit).catch((e) => ({ supply: null, decimals: null, rawSupply: null, note: `supply lookup failed: ${e.message}` })),
  ]);
  const supply = sup.supply;
  const mcapAda = price.ada != null && supply != null ? price.ada * supply : null;
  const mcapUsd = price.usd != null && supply != null ? price.usd * supply : null;
  const notes = ['market-data source (GeckoTerminal) unavailable; falling back to price x Koios total_supply (may be a mint cap, not circulating)'];
  if (price.note) notes.push(price.note);
  if (supply == null) notes.push(sup.note || 'on-chain supply unavailable from Koios');
  return mcapBody(unit, {
    priceUsd: price.usd, priceAda: price.ada,
    supply, decimals: sup.decimals,
    mcapUsd, mcapAda,
    supply_basis: 'total', confidence: 'low',
    source: [price.sources.join('+') || 'none', supply != null ? 'koios' : null].filter(Boolean).join('+'),
    note: notes.join('; '),
    provenance: 'fallback: price = DexHunter; supply = Koios asset_info total_supply (NOT circulating; may be a mint cap)',
  });
}

/** Shared body builder for /token/mcap so the three supply bases stay consistent. */
function mcapBody(unit, x) {
  return {
    status: 200,
    body: dq({
      unit,
      price: { ada: x.priceAda ?? null, usd: x.priceUsd ?? null },
      supply: x.supply ?? null,
      decimals: x.decimals ?? null,
      mcap: { ada: x.mcapAda ?? null, usd: x.mcapUsd ?? null },
      supply_basis: x.supply_basis,   // 'circulating' | 'fdv' | 'total'
      confidence: x.confidence,
      source: x.source,
      as_of: nowIso(),
      ...(x.note ? { note: x.note } : {}),
    }, {
      source: x.source,
      authority_class: x.supply_basis === 'circulating' ? 'C' : 'B',
      refresh: 'on-demand',
      confidence: x.confidence,
      provenance: x.provenance,
    }),
  };
}

/** Run fn over items with bounded concurrency (keeps /tokens/top under the proxy timeout). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/** Latest poller-collected price (ADA) for a unit from the ohlcv table, or null. */
function latestTickAda(unit) {
  const r = get("SELECT c FROM ohlcv WHERE unit = ? AND interval = 'raw' ORDER BY ts DESC LIMIT 1", unit);
  return r && r.c != null ? r.c : null;
}

// A token_market row is "stale" once it is older than this — we still serve it
// but downgrade its confidence and flag it, rather than pretend it's fresh.
const MARKET_STALE_S = 30 * 60; // 30 min (poller runs every 5 min)

/**
 * Confidence for a single ranked metric, from source quality + freshness.
 *   mcap  : circulating (CoinGecko) -> high · fdv fallback -> medium · none -> low
 *   liq/vol: GeckoTerminal aggregate -> medium (single authoritative source)
 * Any stale row is knocked down one notch.
 */
function metricConfidence(by, basis, value, ageS) {
  if (value == null) return 'low';
  let c = by === 'mcap' ? (basis === 'circulating' ? 'high' : 'medium') : 'medium';
  if (ageS != null && ageS > MARKET_STALE_S) c = c === 'high' ? 'medium' : 'low';
  return c;
}

/** GET /tokens/top?by=mcap|volume|liquidity&limit=
 *  Ranks over the tracked set from the poller-collected `token_market` table
 *  (GeckoTerminal). A pure local read, so it stays fast at any coverage size.
 *  mcap prefers circulating market cap and falls back to FDV (flagged); every
 *  row declares its own per-metric confidence and the basis used. */
async function topHandler({ query, ctx }) {
  const by = (query.by || 'mcap').trim();
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 10, 1), 100);
  if (!['mcap', 'volume', 'liquidity'].includes(by)) {
    throw new UpstreamError('invalid by; expected mcap|volume|liquidity', { status: 400, source: 'token' });
  }

  return ctx.cache.getOrSet(`token:top:${by}`, config.cache.rankings, async () => {
    const tickerOf = new Map(SEED_UNITS.map((s) => [s.unit, s.ticker]));
    const usdPerAda = await adaUsd(ctx).catch(() => null);
    const nowS = nowSec();
    const rows = all('SELECT * FROM token_market');

    const ranked = rows.map((m) => {
      const ageS = m.as_of != null ? nowS - m.as_of : null;
      let metricUsd = null, basis = null;
      if (by === 'mcap') {
        if (m.mcap_usd != null) { metricUsd = m.mcap_usd; basis = 'circulating'; }
        else if (m.fdv_usd != null) { metricUsd = m.fdv_usd; basis = 'fdv'; }
      } else if (by === 'liquidity') {
        metricUsd = m.liquidity_usd;
      } else { // volume
        metricUsd = m.volume24h_usd;
      }
      const priceUsd = m.price_usd;
      return {
        unit: m.unit, ticker: tickerOf.get(m.unit) || m.symbol || null,
        metric: { usd: metricUsd, ada: metricUsd != null && usdPerAda ? metricUsd / usdPerAda : null },
        price: priceUsd != null
          ? { usd: priceUsd, ada: usdPerAda ? priceUsd / usdPerAda : null }
          : null,
        ...(by === 'mcap' ? { basis } : {}),
        confidence: metricConfidence(by, basis, metricUsd, ageS),
        stale: ageS != null && ageS > MARKET_STALE_S,
      };
    });

    // For mcap, tier circulating ABOVE fdv so a fully-diluted figure can never
    // masquerade as the #1 market cap; within a tier, sort by value. For
    // liquidity/volume there is no basis distinction — straight value sort.
    const tier = (r) => (by === 'mcap' ? (r.basis === 'circulating' ? 0 : 1) : 0);
    ranked.sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      const av = a.metric.usd, bv = b.metric.usd;
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1; return bv - av;
    });
    const computable = ranked.filter((r) => r.metric.usd != null).length;
    const fdvCount = by === 'mcap' ? ranked.filter((r) => r.basis === 'fdv' && r.metric.usd != null).length : 0;

    const noteBits = [
      `Partial ranking over a tracked set (${rows.length} tokens with market data), NOT a full-ecosystem ranking.`,
      'Source: GeckoTerminal (on-chain DEX aggregation; mcap via CoinGecko circulating supply).',
    ];
    if (by === 'mcap' && fdvCount) noteBits.push(`${fdvCount} token(s) lack circulating supply — ranked by FDV (price x total supply), flagged basis:"fdv".`);
    if (computable === 0) noteBits.push('No market data collected yet for this metric — run the poller (npm run poller --once) to populate token_market.');

    return {
      status: 200,
      body: dq({
        by, ranking: ranked.slice(0, limit), coverage: 'partial',
        tracked_units: rows.length, computable,
        ...(by === 'mcap' ? { fdv_fallback_count: fdvCount } : {}),
        source: 'geckoterminal', as_of: nowIso(),
        note: noteBits.join(' '),
      }, {
        source: 'geckoterminal', authority_class: 'C', refresh: '~5m',
        confidence: computable ? 'medium' : 'low',
        provenance: 'ranking over the tracked set from the token_market table (GeckoTerminal: circulating mcap, FDV fallback, DEX liquidity, 24h volume); ADA values derived from on-chain ADA/USD',
      }),
    };
  });
}

/** The known-token universe: the seed set unioned with any unit that has ohlcv rows. */
function knownTokens() {
  const seenUnits = new Set();
  const out = [];
  for (const s of SEED_UNITS) {
    seenUnits.add(s.unit);
    out.push({ unit: s.unit, ticker: s.ticker, name: s.name, source: 'seed' });
  }
  let trackedUnits = [];
  try {
    trackedUnits = all('SELECT DISTINCT unit FROM ohlcv').map((r) => r.unit);
  } catch {
    trackedUnits = [];
  }
  for (const unit of trackedUnits) {
    if (!unit || seenUnits.has(unit)) continue;
    seenUnits.add(unit);
    out.push({ unit, ticker: null, name: null, source: 'tracked' });
  }
  return out;
}

/** GET /token/search?q= — search seed/tracked set + (best-effort) DexHunter. */
async function searchHandler({ query }) {
  const q = (query.q || '').trim();
  if (!q) throw new UpstreamError('missing required query param: q', { status: 400, source: 'token' });
  const needle = q.toLowerCase();

  // 1) Local seed/tracked set: substring match over ticker, name, and unit.
  const local = knownTokens().filter((t) =>
    (t.ticker && t.ticker.toLowerCase().includes(needle)) ||
    (t.name && t.name.toLowerCase().includes(needle)) ||
    t.unit.toLowerCase().includes(needle),
  ).map((t) => ({ unit: t.unit, ticker: t.ticker, name: t.name, source: t.source }));

  // 2) DexHunter token search — best-effort; degrade to a note on any failure.
  let dexMatches = [];
  let dexNote;
  try {
    const url = `${config.sources.dexhunter.base}/swap/tokens/${encodeURIComponent(q)}`;
    const headers = config.sources.dexhunter.partnerId ? { 'X-Partner-Id': config.sources.dexhunter.partnerId } : {};
    const data = await fetchJSON(url, { source: 'dexhunter', headers, retries: 1, timeoutMs: 8_000 });
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.tokens) ? data.tokens : []);
    dexMatches = rows.map((r) => ({
      unit: r.token_id ?? r.unit ?? r.id ?? null,
      ticker: r.ticker ?? r.token_ticker ?? null,
      name: r.token_ascii ?? r.name ?? r.token_name ?? null,
      source: 'dexhunter',
    })).filter((m) => m.unit);
  } catch (err) {
    dexNote = `dexhunter search unavailable: ${err.message}`;
  }

  // Merge, de-duplicating by unit (local entries win — they carry our labels).
  const byUnit = new Map();
  for (const m of [...local, ...dexMatches]) {
    if (!m.unit) continue;
    if (!byUnit.has(m.unit)) byUnit.set(m.unit, m);
  }
  const results = [...byUnit.values()];

  const sources = ['seed/tracked', ...(dexMatches.length ? ['dexhunter'] : [])].join('+');
  return {
    status: 200,
    body: dq({
      q,
      count: results.length,
      results,
      source: sources,
      as_of: nowIso(),
      ...(dexNote ? { note: dexNote } : {}),
    }, {
      source: sources,
      authority_class: 'C', // DexHunter token index (at-risk platform); local set is a curated seed
      refresh: 'on-demand',
      confidence: results.length ? 'high' : 'low',
      provenance: 'CDL seed/tracked set + DexHunter token search (best-effort)',
    }),
  };
}

/** GET /token/list — known tokens (seed set + ohlcv units). */
async function listHandler() {
  const tokens = knownTokens();
  return {
    status: 200,
    body: dq({
      count: tokens.length,
      tokens,
      coverage: 'partial',
      source: 'seed+ohlcv-table',
      as_of: nowIso(),
      note: 'Known set = curated seed tokens unioned with units present in the ohlcv table — NOT the whole ecosystem.',
    }, {
      source: 'seed+ohlcv-table',
      authority_class: 'B', // curated/on-chain-derived known set
      refresh: 'static',
      confidence: 'high',
      provenance: 'CDL seed set + units observed by the ohlcv poller',
    }),
  };
}

// Number of holder pages (×1000 addresses) we'll pull before reporting "capped".
const HOLDER_PAGE_LIMIT = 1000;
const HOLDER_MAX_PAGES = 5; // cap at ~5000 holders to bound large/slow responses.

/** GET /token/:id — merged detail. Every sub-part degrades to null + a note. */
async function detailHandler({ params, ctx }) {
  const raw = (params.id || '').trim();
  const unit = raw.toLowerCase();
  if (unit !== 'lovelace' && !/^[0-9a-f]{56,}$/.test(unit)) {
    throw new UpstreamError('invalid id: expected "lovelace" or policyId+hexAssetName', { status: 400, source: 'token' });
  }
  const policyId = unit === 'lovelace' ? null : unit.slice(0, 56);
  const assetName = unit === 'lovelace' ? null : unit.slice(56); // hex, may be ''

  const notes = [];

  // --- metadata (CIP-26, with Koios token-registry mirror as a free fallback) ---
  const metaPromise = (async () => {
    if (unit === 'lovelace') return { decimals: 6, ticker: 'ADA', name: 'Cardano', _source: 'definition' };
    try {
      const m = await ctx.cache.getOrSet(`token:meta:${unit}`, config.cache.metadata, () => cip26.metadata(unit));
      if (m) return { ...m, _source: 'cip26' };
    } catch (err) {
      notes.push(`metadata (cip26) failed: ${err.message}`);
    }
    // Fallback: Koios mirrors CIP-26 in token_registry_metadata.
    try {
      const reg = await koios.assetTokenRegistry(policyId, assetName);
      if (reg) {
        return {
          subject: unit,
          name: reg.name ?? null,
          ticker: reg.ticker ?? null,
          decimals: reg.decimals ?? null,
          logo: reg.logo ?? null,
          url: reg.url ?? null,
          description: reg.description ?? null,
          _source: 'koios-registry',
        };
      }
    } catch (err) {
      notes.push(`metadata fallback (koios) failed: ${err.message}`);
    }
    return null;
  })();

  // --- supply (Koios asset_info) ---
  const supplyPromise = koiosSupply(ctx, unit).catch((e) => {
    notes.push(`supply (koios) failed: ${e.message}`);
    return { supply: null, decimals: null, rawSupply: null };
  });

  // --- spot price (DexHunter, with Minswap cross-check via resolvePrice) ---
  const pricePromise = ctx.cache.getOrSet(`token:price:${unit}`, config.cache.price, () => resolvePrice(ctx, unit))
    .catch((e) => {
      notes.push(`price (dexhunter) failed: ${e.message}`);
      return { ada: null, usd: null, confidence: 'low', sources: [], note: 'price unavailable' };
    });

  // --- holder count (Koios asset_addresses, capped) ---
  // Bounded by an overall time budget so a slow/unreachable Koios can never
  // stall the merged detail call (holders degrade to null + a note instead).
  const HOLDER_BUDGET_MS = 5_000;
  const holdersPromise = (async () => {
    if (unit === 'lovelace') return { count: null, capped: false, note: 'holder enumeration not applicable to ADA' };
    const budget = new Promise((resolve) => setTimeout(
      () => resolve({ count: null, capped: false, note: 'holders lookup exceeded time budget' }), HOLDER_BUDGET_MS));
    const work = (async () => {
      try {
        return await ctx.cache.getOrSet(`token:holders:${unit}`, config.cache.holders, async () => {
          let count = 0;
          let capped = false;
          for (let page = 0; page < HOLDER_MAX_PAGES; page++) {
            const rows = await koios.assetAddresses(policyId, assetName, {
              limit: HOLDER_PAGE_LIMIT,
              offset: page * HOLDER_PAGE_LIMIT,
              timeoutMs: 4_000,
              retries: 0,
            });
            count += rows.length;
            if (rows.length < HOLDER_PAGE_LIMIT) break;
            if (page === HOLDER_MAX_PAGES - 1) capped = true;
          }
          return {
            count,
            capped,
            note: capped ? `holder count capped at ${HOLDER_MAX_PAGES * HOLDER_PAGE_LIMIT} (large asset)` : undefined,
          };
        });
      } catch (err) {
        notes.push(`holders (koios) failed: ${err.message}`);
        return { count: null, capped: false };
      }
    })();
    return Promise.race([work, budget]);
  })();

  const [meta, sup, price, holders] = await Promise.all([metaPromise, supplyPromise, pricePromise, holdersPromise]);
  if (holders?.note) notes.push(holders.note);
  if (price?.note) notes.push(price.note);

  const decimals = meta?.decimals ?? sup?.decimals ?? null;

  const sources = [];
  if (meta?._source) sources.push(meta._source);
  if (sup?.supply != null) sources.push('koios');
  if (price?.sources?.length) sources.push(...price.sources);
  if (holders?.count != null) sources.push('koios');
  const source = [...new Set(sources)].join('+') || 'none';

  return {
    status: 200,
    body: dq({
      unit,
      policy_id: policyId,
      asset_name_hex: assetName,
      metadata: meta
        ? { name: meta.name ?? null, ticker: meta.ticker ?? null, decimals,
            logo: meta.logo ?? null, url: meta.url ?? null, description: meta.description ?? null,
            source: meta._source }
        : null,
      supply: sup?.supply ?? null,
      decimals,
      price: { ada: price?.ada ?? null, usd: price?.usd ?? null,
        confidence: price?.confidence ?? 'low', sources: price?.sources ?? [] },
      holders: { count: holders?.count ?? null, capped: holders?.capped ?? false },
      source,
      as_of: nowIso(),
      ...(notes.length ? { note: notes.join('; ') } : {}),
    }, {
      source,
      // Merged detail: dominant authority is on-chain/official metadata + supply (B);
      // price is DexHunter (C) but reported as a labeled sub-field.
      authority_class: 'B',
      refresh: 'on-demand',
      confidence: meta || sup?.supply != null ? 'high' : 'low',
      provenance: 'merged: CIP-26 metadata + Koios asset_info/asset_addresses (on-chain) + DexHunter price',
    }),
  };
}

// ---------------------------------------------------------------------------
// Market snapshot refresh — called by the poller each tick to fill token_market
// from GeckoTerminal. Kept here (next to the schema) so the table's reader and
// writer share one definition. Upserts every unit GeckoTerminal returns;
// units it doesn't track are simply left absent (no fabricated zero rows).
// Returns { fetched, written } for the poller log.
// ---------------------------------------------------------------------------
async function refreshTokenMarket(units, log) {
  const market = await geckoterminal.tokenMarketData(units, { log });
  const ts = nowSec();
  const upsert = db.prepare(`
    INSERT INTO token_market (unit, symbol, price_usd, mcap_usd, fdv_usd, liquidity_usd, volume24h_usd, total_supply, decimals, source, as_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit) DO UPDATE SET
      symbol=excluded.symbol, price_usd=excluded.price_usd, mcap_usd=excluded.mcap_usd,
      fdv_usd=excluded.fdv_usd, liquidity_usd=excluded.liquidity_usd, volume24h_usd=excluded.volume24h_usd,
      total_supply=excluded.total_supply, decimals=excluded.decimals, source=excluded.source, as_of=excluded.as_of
  `);
  let written = 0;
  for (const m of market.values()) {
    upsert.run(m.unit, m.symbol, m.priceUsd, m.mcapUsd, m.fdvUsd, m.liquidityUsd, m.volume24hUsd, m.totalSupply, m.decimals, m.source, ts);
    written++;
  }
  return { fetched: market.size, written };
}

// ---------------------------------------------------------------------------
// Exports used by the poller and tests.
// ---------------------------------------------------------------------------
export const internals = { resolvePrice, adaUsd, koiosSupply, knownTokens, refreshTokenMarket, SEED_UNITS, USDM_UNIT };

export default {
  name: 'token',
  init,
  routes: [
    // Literal paths first so they are not shadowed by /token/:id.
    { method: 'GET', path: '/token/price', handler: priceHandler, meta: { desc: 'spot price (ada+usd), confidence, source' } },
    { method: 'GET', path: '/token/ohlcv', handler: ohlcvHandler, meta: { desc: 'candles from the ohlcv table' } },
    { method: 'GET', path: '/token/mcap', handler: mcapHandler, meta: { desc: 'price x on-chain supply' } },
    { method: 'GET', path: '/token/search', handler: searchHandler, meta: { desc: 'search seed/tracked + DexHunter by ticker/name' } },
    { method: 'GET', path: '/token/list', handler: listHandler, meta: { desc: 'known tokens (seed + ohlcv units)' } },
    { method: 'GET', path: '/tokens/top', handler: topHandler, meta: { desc: 'partial ranking by mcap|volume|liquidity' } },
    // Parameterized catch-all LAST.
    { method: 'GET', path: '/token/:id', handler: detailHandler, meta: { desc: 'merged detail: metadata+supply+price+holders' } },
  ],
};
