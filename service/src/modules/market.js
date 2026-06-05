// Market module (Stream B) — read layer over the `ohlcv` table the history
// clock (poller cron) writes, plus on-demand spot price.
//
// Routes:
//   GET /markets                          overview: tracked unit count + latest tick per unit
//   GET /price/:id                        spot price (ADA + USD), confidence, source
//   GET /price/history/:id?limit=         raw tick history (interval='raw') newest-first
//   GET /ohlcv/:id?interval=1h&limit=     candles aggregated ON READ from raw ticks
//
// Design notes:
//   - The same `ohlcv` table is shared with token.js. init() creates it with the
//     identical `CREATE TABLE IF NOT EXISTS` so this module is safe whether it or
//     token loads first.
//   - We never write here (the poller owns writing). On-read bucketing turns the
//     stored raw ticks into o/h/l/c candles for the requested interval, exactly
//     like token.js ohlcvHandler (o=first, h=max, l=min, c=last, v=null).
//   - Price strategy mirrors token.js: DexHunter is primary (aggregate across
//     DEXes), Minswap is a cross-check; USD is derived on-chain from the ADA/USDM
//     pair (no centralized oracle). Single-source => confidence 'low'.
//   - Every response carries the data-quality envelope via dq().

import { all, get } from '../db.js';
import { config } from '../config.js';
import { UpstreamError } from '../http.js';
import { dq } from '../lib/envelope.js';
import * as dexhunter from '../sources/dexhunter.js';
import * as minswap from '../sources/minswap.js';

const nowIso = () => new Date().toISOString();

// USDM stablecoin unit — used only to derive ADA's USD value on-chain (the
// ADA/USDM average price is, by construction, ADA's price in ≈1-USD units).
const USDM_UNIT = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d';

const VALID_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const INTERVAL_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

const QUALITY = {
  source: 'dexhunter+minswap',
  authority_class: 'C',
  refresh: '~5m',
  provenance: 'On-chain DEX aggregator (DexHunter, cross-checked Minswap); history via OHLCV poller cron',
};

// ---------------------------------------------------------------------------
// init: ensure the shared ohlcv table exists. Identical schema to token.js so
// it is safe whichever module inits first.
// ---------------------------------------------------------------------------
export async function init(ctx) {
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      unit     TEXT    NOT NULL,
      ts       INTEGER NOT NULL,
      interval TEXT    NOT NULL,
      o        REAL,
      h        REAL,
      l        REAL,
      c        REAL,
      v        REAL,
      source   TEXT,
      PRIMARY KEY (unit, interval, ts)
    );
  `);
  ctx.db.exec('CREATE INDEX IF NOT EXISTS idx_ohlcv_unit_interval_ts ON ohlcv (unit, interval, ts);');
  ctx.log?.('market: ohlcv table ready');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate a path :id (a token unit). Returns the lowercased unit. */
function requireUnit(params) {
  const id = (params?.id || '').trim();
  if (!id) throw new UpstreamError('missing required path param: id', { status: 400, source: 'market' });
  if (id !== 'lovelace' && !/^[0-9a-fA-F]{56,}$/.test(id)) {
    throw new UpstreamError('invalid id: expected "lovelace" or policyId+hexAssetName', { status: 400, source: 'market' });
  }
  return id.toLowerCase() === 'lovelace' ? 'lovelace' : id.toLowerCase();
}

/** ADA's USD price, derived on-chain via ADA/USDM. Cached. null if not routable. */
async function adaUsd(ctx) {
  return ctx.cache.getOrSet('market:ada_usd', config.cache.price, async () => {
    const usd = await dexhunter.rawAdaUsd(USDM_UNIT);
    return usd && usd > 0 ? usd : null;
  });
}

/**
 * Resolve a token's spot price in ADA across sources with a cross-check.
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

  const primary = candidates.find((c) => c.src === 'dexhunter') || candidates[0];
  const ada = primary.ada;
  const usd = usdPerAda != null ? ada * usdPerAda : null;

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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /markets — overview of the tracked set + latest tick per unit. */
async function marketsHandler() {
  // Distinct units that have any rows. Latest raw tick per unit (price + ts).
  const units = all('SELECT DISTINCT unit FROM ohlcv').map((r) => r.unit);
  const markets = [];
  for (const unit of units) {
    const latest = get(
      'SELECT ts, c, source FROM ohlcv WHERE unit = ? AND interval = ? ORDER BY ts DESC LIMIT 1',
      unit, 'raw',
    );
    if (!latest) continue;
    markets.push({
      unit,
      price: { ada: latest.c },
      ts: latest.ts,
      time: new Date(latest.ts * 1000).toISOString(),
      source: latest.source || null,
    });
  }
  markets.sort((a, b) => b.ts - a.ts);

  const note = markets.length === 0
    ? 'no tracked units yet: run the ohlcv poller (npm run poller, or the --once cron) to begin collecting ticks'
    : 'tracked set = units with collected ticks only; NOT a full ecosystem listing';

  return {
    status: 200,
    body: dq({
      tracked_units: units.length,
      markets,
      count: markets.length,
      as_of: nowIso(),
      note,
    }, {
      ...QUALITY,
      source: 'ohlcv-table',
      confidence: markets.length ? 'medium' : 'low',
    }),
  };
}

/** GET /price/:id — on-demand spot price (ADA + USD). */
async function priceHandler({ params, ctx }) {
  const unit = requireUnit(params);
  const p = await ctx.cache.getOrSet(`market:price:${unit}`, config.cache.price, () => resolvePrice(ctx, unit));
  return {
    status: 200,
    body: dq({
      unit,
      price: { ada: p.ada, usd: p.usd },
      confidence: p.confidence,
      source: p.sources.length ? p.sources.join('+') : 'none',
      as_of: nowIso(),
      ...(p.note ? { note: p.note } : {}),
    }, {
      ...QUALITY,
      source: p.sources.length ? p.sources.join('+') : 'none',
      refresh: 'on-demand',
      confidence: p.confidence,
    }),
  };
}

/** GET /price/history/:id?limit= — raw tick rows, newest-first. */
async function historyHandler({ params, query }) {
  const unit = requireUnit(params);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 100, 1), 1000);

  const rows = all(
    'SELECT ts, o, h, l, c, v, source FROM ohlcv WHERE unit = ? AND interval = ? ORDER BY ts DESC LIMIT ?',
    unit, 'raw', limit,
  );
  const ticks = rows.map((r) => ({
    ts: r.ts,
    time: new Date(r.ts * 1000).toISOString(),
    o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    source: r.source,
  }));
  const note = ticks.length === 0
    ? 'no raw ticks yet: run the ohlcv poller (npm run poller, or the --once cron) to start collecting history'
    : undefined;

  return {
    status: 200,
    body: dq({
      unit,
      interval: 'raw',
      ticks,
      count: ticks.length,
      source: ticks.length ? [...new Set(ticks.map((t) => t.source).filter(Boolean))].join('+') : 'ohlcv-table',
      as_of: nowIso(),
      ...(note ? { note } : {}),
    }, {
      ...QUALITY,
      source: 'ohlcv-table',
      confidence: ticks.length ? 'medium' : 'low',
    }),
  };
}

/** GET /ohlcv/:id?interval=1h&limit= — candles aggregated on read from raw ticks. */
async function ohlcvHandler({ params, query }) {
  const unit = requireUnit(params);
  const interval = (query.interval || '1h').trim();
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 100, 1), 1000);

  if (!VALID_INTERVALS.has(interval)) {
    throw new UpstreamError(`invalid interval; expected one of ${[...VALID_INTERVALS].join(',')}`, { status: 400, source: 'market' });
  }

  const sec = INTERVAL_SECONDS[interval];
  // Pull raw ticks ascending and bucket them into o/h/l/c candles on read.
  // o=first tick, h=max, l=min, c=last tick in each bucket; v stays null (we do
  // not yet capture per-interval on-chain volume).
  const raw = all(
    'SELECT ts, c, v, source FROM ohlcv WHERE unit = ? AND interval = ? ORDER BY ts ASC',
    unit, 'raw',
  );
  const buckets = new Map();
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
    ts: b,
    time: new Date(b * 1000).toISOString(),
    o: k.o, h: k.h, l: k.l, c: k.c, v: k.v,
    source: [...k.src].join('+') || null,
  }));

  let note = 'candles aggregated on read from raw price ticks; volume is null (per-interval on-chain volume not yet captured)';
  if (candles.length === 0) {
    const rawCount = get('SELECT COUNT(*) AS n FROM ohlcv WHERE unit = ?', unit)?.n || 0;
    note = rawCount === 0
      ? 'no candles yet: run the ohlcv poller (npm run poller, or the --once cron) with this unit tracked'
      : `${rawCount} raw point(s) exist but none fell into the requested window`;
  }

  return {
    status: 200,
    body: dq({
      unit,
      interval,
      candles,
      count: candles.length,
      source: candles.length ? [...new Set(candles.flatMap((c) => (c.source || '').split('+')).filter(Boolean))].join('+') : 'ohlcv-table',
      as_of: nowIso(),
      note,
    }, {
      ...QUALITY,
      source: 'ohlcv-table',
      confidence: candles.length ? 'medium' : 'low',
    }),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const internals = { resolvePrice, adaUsd, USDM_UNIT };

export default {
  name: 'market',
  init,
  routes: [
    // Literal route first, then the three /:id namespaces (each in its own path
    // prefix so there is no ordering ambiguity; history before plain price/:id
    // to keep the more specific path earlier).
    { method: 'GET', path: '/markets', handler: marketsHandler, meta: { desc: 'overview: tracked units + latest tick per unit' } },
    { method: 'GET', path: '/price/history/:id', handler: historyHandler, meta: { desc: 'raw tick history for a unit, newest-first' } },
    { method: 'GET', path: '/price/:id', handler: priceHandler, meta: { desc: 'spot price (ada+usd), confidence, source' } },
    { method: 'GET', path: '/ohlcv/:id', handler: ohlcvHandler, meta: { desc: 'candles aggregated on read from the ohlcv table' } },
  ],
};
