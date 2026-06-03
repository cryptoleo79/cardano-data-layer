// seed-project-store.js — standalone (re)loader for the project + category moat.
//
// Run with `npm run seed`. Unlike the server's init() (which seeds only when the
// store is empty), this job ALWAYS reconciles the seed JSON against the existing
// store using the versioned upsert. It is idempotent: re-running records a
// project_history row only for fields that have actually changed, so you can
// safely run it after refreshing seed/*.json from the preservation archive.
//
// Zero external dependencies: it reuses the shared db handle and the module's
// own loadSeed/createTables/upsert logic so the write path is identical to the
// server's, guaranteeing the same provenance + audit guarantees.

import { db } from '../db.js';
import { config } from '../config.js';
import projectModule, { loadSeed } from '../modules/project.js';

const log = (...a) => console.log(new Date().toISOString(), '[seed]', ...a);

async function main() {
  log(`db: ${config.dbPath}`);
  log(`seedDir: ${config.seedDir}`);

  // Ensure the schema exists (the job may run before the server ever has).
  // We reuse the module's init with a minimal ctx, but suppress its
  // "seed only if empty" behaviour by calling loadSeed ourselves afterward.
  await projectModule.init({ db, config, log: () => {} });

  // Snapshot counts before, to report what reconciliation did.
  const before = {
    categories: db.prepare('SELECT COUNT(*) AS n FROM category').get().n,
    projects: db.prepare('SELECT COUNT(*) AS n FROM project').get().n,
    history: db.prepare('SELECT COUNT(*) AS n FROM project_history').get().n,
  };

  // Always reconcile against the seed (this is the point of the job).
  const summary = loadSeed(db, config.seedDir, { changeSource: 'seed:job', log });

  const after = {
    categories: db.prepare('SELECT COUNT(*) AS n FROM category').get().n,
    projects: db.prepare('SELECT COUNT(*) AS n FROM project').get().n,
    history: db.prepare('SELECT COUNT(*) AS n FROM project_history').get().n,
  };

  log('--- summary ---');
  log(`source: categories=${summary.catSource}, projects=${summary.projSource}, as_of=${summary.as_of}`);
  log(`categories: ${before.categories} -> ${after.categories}`);
  log(`projects:   ${before.projects} -> ${after.projects} ` +
      `(inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged})`);
  log(`history rows: ${before.history} -> ${after.history} ` +
      `(+${after.history - before.history} from ${summary.changedFields} field changes this run)`);
  log('done.');
}

main().catch((err) => {
  console.error('seed job failed:', err);
  process.exitCode = 1;
});
