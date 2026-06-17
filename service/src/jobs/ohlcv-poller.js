// OHLCV poller — standalone script (npm run poller).
//
// Every config.poller.intervalMs, for each unit in config.poller.units (falling
// back to the token module's seed set when none configured), fetch the current
// on-chain spot price and INSERT a candle row into the `ohlcv` table.
//
// SCOPE / HONESTY NOTE: this writes 'raw' price *points*, not aggregated
// candles. Each tick stores o=h=l=c=price and v=null (we don't yet have a
// reliable per-interval on-chain volume read). True OHLCV aggregation (bucketing
// raw points into 1m/1h/1d candles with real high/low/volume) is a documented
// follow-up. Storing raw points now means the aggregation job can be added later
// without losing history.
//
// Resilience: one unit failing (illiquid pair, upstream hiccup) must not stop
// the others or crash the loop. Errors are logged and the poller continues.

import { TtlCache } from '../cache.js';
import { config } from '../config.js';
import { db, run, all } from '../db.js';
import tokenModule, { internals } from '../modules/token.js';

const log = (...a) => console.log(new Date().toISOString(), '[poller]', ...a);

// Reuse the module's ctx shape so we share price resolution and the table init.
const ctx = { db, cache: new TtlCache(), config, log };

const INTERVAL_LABEL = 'raw'; // these are raw points, not bucketed candles

// Which units to poll for OHLCV price ticks: operator config first, else the
// curated seed set. (Kept to the curated set — the long tail's price history
// isn't worth a DexHunter call per token per tick.)
function resolveUnits() {
  if (config.poller.units.length) return config.poller.units;
  return internals.SEED_UNITS.map((s) => s.unit);
}

// Per-tick rate budget. The keyless GeckoTerminal tier throttles bursts hard
// (~3 multi-calls before sustained 429s; 30 units/multi-call), so we cap the
// whole tick at ~7 chunks worth of units. Priority is filled first; whatever
// budget remains funds one rotating tail slice that advances coverage.
const UNITS_PER_CHUNK = 30;
const MAX_CHUNKS = 7;
const MAX_UNITS = UNITS_PER_CHUNK * MAX_CHUNKS; // ~210
const TAIL_SLICE = 90; // tail units per tick when budget allows
// How many of the top liquidity / volume rows feed the dynamic priority set.
// Raised from 40 -> 80: at 40 the cutoff sat at ~$35k liquidity, so the genuine
// mid-tier (the $10k-100k band) rotated through the slow tail and went stale even
// though it is real, non-dust depth. 80 pushes the cutoff down to ~$7k, keeping
// every liquidity/volume-bearing row that a user would plausibly rank by fresh,
// while the deduped priority set still stays well under MAX_UNITS (leaving room
// for the rotating tail slice that advances long-tail coverage each tick).
const TOP_LIQ = 80;
const TOP_VOL = 80;

// The token_market refresh set for THIS tick. Rather than refreshing only the
// curated seed every tick, we build a DYNAMIC priority set from the current
// token_market table so the *visible top* of every ranking stays fresh:
//   - every unit with a non-null mcap_usd (the accurate circulating-mcap set),
//   - the top TOP_LIQ by liquidity_usd, the top TOP_VOL by volume24h_usd,
//   - the curated SEED_UNITS (nicer tickers + guaranteed floor),
// deduped. Then we ADD one rotating slice of the remaining universe so coverage
// still advances over many ticks. The total is capped at MAX_UNITS (priority
// first); if priority alone exceeds the cap it's truncated and the tail is
// skipped this tick. Slice index is clock-derived so no cursor state is needed.
function marketRefreshSet() {
  const seed = internals.SEED_UNITS.map((s) => s.unit);

  // Pull the dynamic priority signals from the live market table. Reads are
  // local SQLite; on any failure fall back to the curated seed alone.
  let dynamic = [];
  try {
    const withMcap = all('SELECT unit FROM token_market WHERE mcap_usd IS NOT NULL').map((r) => r.unit);
    const topLiq = all(
      'SELECT unit FROM token_market WHERE liquidity_usd IS NOT NULL ORDER BY liquidity_usd DESC LIMIT ?',
      TOP_LIQ,
    ).map((r) => r.unit);
    const topVol = all(
      'SELECT unit FROM token_market WHERE volume24h_usd IS NOT NULL ORDER BY volume24h_usd DESC LIMIT ?',
      TOP_VOL,
    ).map((r) => r.unit);
    dynamic = [...withMcap, ...topLiq, ...topVol];
  } catch (err) {
    log(`market: dynamic priority query failed (using seed only): ${err.message}`);
  }

  // Priority = dynamic signals + curated seed, deduped, capped at MAX_UNITS.
  let priority = [...new Set([...dynamic, ...seed])];
  let capped = false;
  if (priority.length > MAX_UNITS) {
    priority = priority.slice(0, MAX_UNITS);
    capped = true;
  }

  const prioritySet = new Set(priority);
  const tail = internals.MARKET_UNITS.filter((u) => !prioritySet.has(u));
  const tailBudget = Math.max(0, Math.min(TAIL_SLICE, MAX_UNITS - priority.length));

  if (!tail.length || tailBudget === 0) {
    log(`market: priority ${priority.length}${capped ? ' (capped)' : ''} + tail 0` +
        ` = ${priority.length} unit(s)`);
    return priority;
  }

  const slices = Math.ceil(tail.length / tailBudget);
  const idx = Math.floor(Date.now() / config.poller.intervalMs) % slices;
  const slice = tail.slice(idx * tailBudget, idx * tailBudget + tailBudget);
  const set = [...priority, ...slice];
  log(`market: priority ${priority.length}${capped ? ' (capped)' : ''}` +
      ` + tail slice ${idx + 1}/${slices} (${slice.length}) = ${set.length} unit(s)`);
  return set;
}

// Insert (or replace) one raw point for a unit at the current second.
function writePoint(unit, price, source) {
  const ts = Math.floor(Date.now() / 1000);
  run(
    `INSERT INTO ohlcv (unit, ts, interval, o, h, l, c, v, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(unit, interval, ts) DO UPDATE SET
       o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v, source=excluded.source`,
    unit, ts, INTERVAL_LABEL, price, price, price, price, null, source,
  );
  return ts;
}

async function pollOnce() {
  const units = resolveUnits();
  log(`tick: polling ${units.length} unit(s)`);

  // Market snapshot (mcap/liquidity/volume) from GeckoTerminal into token_market.
  // The verified universe (~1,044) is too large to sweep every tick under the
  // free GeckoTerminal rate limit, so we ROTATE: the curated priority set
  // refreshes every tick (fresh headline rankings) plus one rotating slice of
  // the long tail, covering the whole universe over a handful of ticks. Reads
  // stay local; a failure here must not stop price-tick collection below.
  try {
    const refreshSet = marketRefreshSet();
    const r = await internals.refreshTokenMarket(refreshSet, (m) => log(`  market: ${m}`));
    log(`market: refreshed ${refreshSet.length} unit(s) -> ${r.written} written (${r.fetched} returned by GeckoTerminal)`);
  } catch (err) {
    log(`market: refresh failed (continuing): ${err.message}`);
  }

  let ok = 0, skipped = 0, failed = 0;

  for (const unit of units) {
    try {
      // resolvePrice gives us the cross-checked ADA spot price + source list.
      const p = await internals.resolvePrice(ctx, unit);
      if (p.ada == null) {
        skipped++;
        log(`  ${unit.slice(0, 16)}… no price (${p.note || 'illiquid'})`);
        continue;
      }
      const source = p.sources.length ? p.sources.join('+') : 'unknown';
      const ts = writePoint(unit, p.ada, source);
      ok++;
      log(`  ${unit.slice(0, 16)}… ada=${p.ada} src=${source} conf=${p.confidence} ts=${ts}`);
    } catch (err) {
      failed++;
      log(`  ${unit.slice(0, 16)}… ERROR ${err.message}`);
    }
  }
  log(`tick done: ${ok} written, ${skipped} skipped, ${failed} failed`);
}

async function main() {
  // Ensure the ohlcv table exists even if the poller runs before the server.
  await tokenModule.init(ctx);

  // `--once` runs a single tick and exits — the cron-friendly mode for durable
  // history collection (a `*/5 * * * *` entry is more resilient than a
  // long-running daemon). Without it, the poller daemonizes on the interval.
  if (process.argv.includes('--once')) {
    log('single-shot (--once)');
    await pollOnce();
    process.exit(0);
  }

  log(`starting; interval=${config.poller.intervalMs}ms; units=${resolveUnits().length}` +
      (config.poller.units.length ? '' : ' (using token seed set; set CDL_POLL_UNITS to override)'));

  await pollOnce(); // poll immediately on start

  const timer = setInterval(() => {
    pollOnce().catch((e) => log('pollOnce crashed (continuing):', e.message));
  }, config.poller.intervalMs);

  // Clean shutdown.
  const stop = (sig) => { log(`${sig} received, stopping`); clearInterval(timer); process.exit(0); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((e) => { log('fatal:', e.message); process.exit(1); });
