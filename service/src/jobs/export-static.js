// export-static.js — export Project Memory to static JSON for the surface layer.
//
// The Data Layer service is not deployed; the observatory site is. So we export
// the read-only Project Memory views as static JSON (the same pattern the
// observatory uses for governance data) which static pages fetch. Output:
//   <out>/index.json            list of projects + categories + meta
//   <out>/projects/<id>.json    one project: claims + provenance + evidence + history
//
// Usage: node src/jobs/export-static.js [outDir]
//   default outDir = ../../../observatory/data/snapshots/projectmemory
//
// Re-derives everything from the event log first (seed-if-empty + rebuild), so
// the export is reproducible from the archive with no manual state.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initEventStore, eventCount, verifyChain } from '../projectmemory/eventstore.js';
import { initProjections } from '../projectmemory/schema.js';
import { rebuildProjections } from '../projectmemory/reducer.js';
import { seedIfEmpty } from '../projectmemory/seed.js';
import { listProjects, getProject, listCategories, historyForProject } from '../projectmemory/read.js';

const outDir = process.argv[2] || join(homedir(), 'observatory', 'data', 'snapshots', 'projectmemory');
const GENERATED_AT = process.env.CDL_EXPORT_TS || new Date().toISOString();

initEventStore();
initProjections();
const seed = seedIfEmpty();
const replayed = rebuildProjections();
const chain = verifyChain();

// primary provenance for a project = its name (or ticker) claim's source/authority
function primaryProvenance(detail) {
  const c = detail.fields?.name?.[0] || detail.fields?.ticker?.[0] || null;
  if (!c) return { source_id: null, authority_class: null };
  return { source_id: c.provenance?.source?.source_id ?? null, authority_class: c.provenance?.authority_class ?? null };
}

// URL/filesystem-safe key for a project id (ids like "tt:MELD" contain ':').
const fileKey = (id) => id.replace(/[^A-Za-z0-9._-]/g, '_');

mkdirSync(join(outDir, 'projects'), { recursive: true });

// --- per-project detail files + enriched list rows ---
const listRows = [];
const { projects } = listProjects({ limit: 1000 });
for (const row of projects) {
  const detail = getProject(row.id);
  const history = historyForProject(row.id);
  const prov = primaryProvenance(detail);
  // count evidence + claims for the list view
  const claimFields = Object.keys(detail.fields || {});
  const evidenceCount = Object.values(detail.fields || {}).flat()
    .reduce((n, c) => n + (c.provenance?.evidence?.length || 0), 0);
  const file = `${fileKey(row.id)}.json`;
  writeFileSync(join(outDir, 'projects', file),
    JSON.stringify({ project: detail, history: history.events, generated_at: GENERATED_AT }, null, 2));
  listRows.push({
    id: detail.id, file, kind: detail.kind,
    name: detail.name || detail.fields?.ticker?.[0]?.value || row.id, status: detail.status,
    rank: detail.fields?.rank?.[0]?.value ?? null,
    unclassified: detail.unclassified, source_id: prov.source_id, authority_class: prov.authority_class,
    category_count: detail.categories.length, claim_fields: claimFields.length,
    evidence_count: evidenceCount, history_count: history.count,
    superseded_claim_count: detail.superseded_claim_count,
  });
}

const categories = listCategories().categories;

const index = {
  meta: {
    generated_at: GENERATED_AT,
    source: 'cardano-project-memory (event-sourced); seeded from cardano-project-memory-archive',
    events: eventCount(),
    replayed,
    chain_ok: chain.ok,
    chain_head: chain.head,
    seeded_this_run: seed.seeded,
    counts: {
      projects: listRows.length,
      categories: categories.length,
      defunct: listRows.filter((r) => r.status === 'defunct').length,
      tokens: listRows.filter((r) => r.kind === 'token').length,
    },
    authority_legend: { A: 'On-chain', B: 'Official', C: 'At-risk platform', D: 'Community', E: 'Researcher' },
  },
  categories,
  projects: listRows.sort((a, b) => a.id.localeCompare(b.id)),
};

writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

console.log(`exported to ${outDir}`);
console.log(`  projects=${listRows.length} categories=${categories.length} events=${eventCount()} chain_ok=${chain.ok}`);
