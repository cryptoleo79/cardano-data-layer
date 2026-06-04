// seed-project-store.js — Project Memory bootstrap CLI (`npm run seed`).
//
// Event-sourced: ensures the log + projections exist, seeds from the archive IF
// the event log is empty (emitting events, never writing projections), then
// rebuilds projections from the log and verifies the hash chain. Idempotent at
// the bootstrap level — re-running on a populated log is a no-op for the seed.
// The governed write path for incremental updates is intentionally not built.

import { initEventStore, eventCount, verifyChain } from '../projectmemory/eventstore.js';
import { initProjections } from '../projectmemory/schema.js';
import { rebuildProjections } from '../projectmemory/reducer.js';
import { seedIfEmpty } from '../projectmemory/seed.js';

const log = (...a) => console.log(new Date().toISOString(), '[seed]', ...a);

initEventStore();
initProjections();
const before = eventCount();
const result = seedIfEmpty();
const replayed = rebuildProjections();
const chain = verifyChain();

log(`events before=${before} after=${eventCount()}`);
log(`seed: ${JSON.stringify(result)}`);
log(`projections rebuilt from ${replayed} events`);
log(`chain verified: ${chain.ok} (head=${chain.head?.slice(0, 16)}…, count=${chain.count})`);
if (!chain.ok) { log('CHAIN VERIFICATION FAILED'); process.exit(1); }
