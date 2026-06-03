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

// Which units to poll: operator config first, else the module's seed set.
function resolveUnits() {
  if (config.poller.units.length) return config.poller.units;
  return internals.SEED_UNITS.map((s) => s.unit);
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
