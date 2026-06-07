// Project Memory — seed (PM-BUILD-5).
//
// Bootstraps the layer by EMITTING EVENTS (never by writing projections), so the
// event log remains the source of truth and projections rebuild from it. The
// seed imports, with chain-of-custody preserved on every claim:
//   - cardanocube taxonomy (74 categories)         -> source cardanocube (D)
//   - cardanocube graveyard projects (defunct)     -> source cardanocube (D), evidence = archive wayback+sha
//   - preserved TapTools historical rankings        -> source taptools-wayback (C), evidence = archive wayback+sha
//
// No manual editing: every value traces to an archived artifact. Seeds only when
// the log is empty (idempotent at the bootstrap level).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { append, eventCount } from './eventstore.js';

const ARCHIVE = process.env.CDL_ARCHIVE || join(homedir(), 'cardano-project-memory-archive');
const ACTOR = 'machine:seed';

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

// Pull the ranked "# N TICKER" list out of a preserved TapTools ranking-grid snapshot.
function parseTapToolsRanks(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&');
  const out = [];
  const seen = new Set();
  const re = /#\s*(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{1,11})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const rank = Number(m[1]);
    const ticker = m[2];
    if (rank < 1 || rank > 100 || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ rank, ticker });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// Find the content-bearing charts snapshot with the most ranked entries.
function bestTapToolsSnapshot() {
  const dir = join(ARCHIVE, 'taptools-via-wayback', 'rankings', 'charts');
  if (!existsSync(dir)) return null;
  let best = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    const custodyPath = join(dir, `${f}.custody.json`);
    if (!existsSync(custodyPath)) continue;
    const ranks = parseTapToolsRanks(readFileSync(join(dir, f), 'utf8'));
    if (!best || ranks.length > best.ranks.length) {
      best = { file: f, custody: readJson(custodyPath), ranks };
    }
  }
  return best && best.ranks.length ? best : null;
}

export function seedIfEmpty() {
  if (eventCount() > 0) return { seeded: false, reason: 'log not empty' };

  let categories = 0, projects = 0, tokens = 0;

  // --- sources ---
  append('source.registered', { actor: ACTOR, payload: {
    source_id: 'cardanocube', kind: 'cardanocube', authority_class: 'D',
    url: 'https://cardanocube.com', label: 'CardanoCube community directory' } });
  append('source.registered', { actor: ACTOR, payload: {
    source_id: 'taptools-wayback', kind: 'taptools-wayback', authority_class: 'C',
    url: 'https://taptools.io', label: 'TapTools (preserved via Wayback Machine)' } });

  // --- cardanocube taxonomy ---
  const catFile = join(config.seedDir, 'categories.json');
  if (existsSync(catFile)) {
    const cj = readJson(catFile);
    for (const c of cj.categories) {
      append('category.added', { actor: ACTOR, ts: c.as_of, payload: {
        slug: c.slug, name: c.name, source_id: 'cardanocube', as_of: c.as_of, taxonomy_note: c.taxonomy_note } });
      categories++;
    }
  }

  // --- cardanocube graveyard projects (defunct), with chain-of-custody ---
  const projFile = join(config.seedDir, 'projects.json');
  if (existsSync(projFile)) {
    const pj = readJson(projFile);
    for (const p of pj.projects) {
      const evidence = [];
      if (p.archived_wayback_url) {
        evidence.push({ kind: 'wayback', ref: p.archived_wayback_url, sha256: p.archived_sha256 || null,
          description: 'Archived editorial profile (chain-of-custody from cardano-project-memory-archive)' });
      }
      append('project.imported', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: { id: p.id, kind: 'project' } });
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: {
        project_id: p.id, field: 'name', value: p.name, source_id: 'cardanocube', authority_class: 'D',
        as_of: p.as_of, asserted_by: ACTOR, evidence } });
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: {
        project_id: p.id, field: 'status', value: 'defunct', source_id: 'cardanocube', authority_class: 'D',
        as_of: p.as_of, asserted_by: ACTOR, evidence,
        // status provenance note: cardanocube /projects/graveyard listing
      } });
      projects++;
    }
  }

  // --- preserved TapTools historical rankings, with chain-of-custody ---
  const tt = bestTapToolsSnapshot();
  if (tt) {
    const asOf = `${tt.custody.capture_date || ''}` || null;
    const evidence = [{ kind: 'wayback', ref: tt.custody.wayback_url, sha256: tt.custody.sha256 || null,
      description: `TapTools ranking-grid snapshot ${tt.file} (chain-of-custody from cardano-project-memory-archive)` }];
    for (const { rank, ticker } of tt.ranks) {
      const id = `tt:${ticker}`;
      append('project.imported', { actor: ACTOR, subject: id, ts: asOf, payload: { id, kind: 'token' } });
      append('claim.asserted', { actor: ACTOR, subject: id, ts: asOf, payload: {
        project_id: id, field: 'ticker', value: ticker, source_id: 'taptools-wayback', authority_class: 'C',
        as_of: asOf, asserted_by: ACTOR, evidence } });
      append('claim.asserted', { actor: ACTOR, subject: id, ts: asOf, payload: {
        project_id: id, field: 'rank', value: rank, source_id: 'taptools-wayback', authority_class: 'C',
        as_of: asOf, asserted_by: ACTOR, evidence } });
      tokens++;
    }
  }

  // --- Built on Cardano directory: projects + category assignments ---
  let boc = 0, bocAssign = 0;
  const bocFile = join(config.seedDir, 'builtoncardano-projects.json');
  if (existsSync(bocFile)) {
    const bj = readJson(bocFile);
    append('source.registered', { actor: ACTOR, payload: {
      source_id: 'builtoncardano', kind: 'builtoncardano', authority_class: 'B',
      url: bj.source_url, label: 'Built on Cardano directory (Cardano Foundation)' } });
    const ev = [{ kind: 'url', ref: bj.source_url,
      description: 'Listed in the Built on Cardano ecosystem directory (Cardano Foundation curation)' }];
    const mk = (id, field, value) => append('claim.asserted', { actor: ACTOR, subject: id, ts: bj.as_of, payload: {
      project_id: id, field, value, source_id: 'builtoncardano', authority_class: 'B', as_of: bj.as_of, asserted_by: ACTOR, evidence: ev } });
    for (const p of bj.projects) {
      append('project.imported', { actor: ACTOR, subject: p.id, ts: bj.as_of, payload: { id: p.id, kind: 'project' } });
      mk(p.id, 'name', p.name);
      if (p.link) mk(p.id, 'website', p.link);
      if (p.description) mk(p.id, 'description', p.description);
      mk(p.id, 'status', p.status);
      for (const slug of p.categories) {
        append('category.assigned', { actor: ACTOR, subject: p.id, ts: bj.as_of, payload: {
          project_id: p.id, category_slug: slug, source_id: 'builtoncardano', authority_class: 'B',
          as_of: bj.as_of, confidence: 'high', evidence: ev } });
        bocAssign++;
      }
      boc++;
    }
  }

  return { seeded: true, sources: 3, categories, projects, tokens, boc, bocAssign, snapshot: tt?.file || null };
}
