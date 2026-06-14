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
import { db, run } from '../db.js';
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

// How many long-tail units to refresh per tick. Kept small because the keyless
// GeckoTerminal tier throttles bursts hard — the priority set already consumes
// most of a tick's usable budget, so the tail advances a little each tick and
// the whole universe is covered over many ticks (token_market persists between
// ticks, so partial progress is never lost).
const TAIL_SLICE = 90;

// The token_market refresh set for THIS tick: all priority (seed) units every
// time, plus a rotating slice of the rest of the verified universe so the whole
// set is covered over ceil(tail / TAIL_SLICE) ticks without tripping the rate
// limit. Slice index is derived from the clock so no cursor state is needed.
function marketRefreshSet() {
  const priority = internals.SEED_UNITS.map((s) => s.unit);
  const prioritySet = new Set(priority);
  const tail = internals.MARKET_UNITS.filter((u) => !prioritySet.has(u));
  if (!tail.length) return priority;
  const slices = Math.ceil(tail.length / TAIL_SLICE);
  const idx = Math.floor(Date.now() / config.poller.intervalMs) % slices;
  const slice = tail.slice(idx * TAIL_SLICE, idx * TAIL_SLICE + TAIL_SLICE);
  log(`market: priority ${priority.length} + tail slice ${idx + 1}/${slices} (${slice.length})`);
  return [...priority, ...slice];
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
