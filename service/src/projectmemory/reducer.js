// Project Memory — reducer (PM-BUILD-1).
//
// Pure function of the event log: apply(event) mutates ONLY the projection
// tables (never pm_event). rebuildProjections() drops the read-model and
// replays the entire log, proving the projections are derived, not primary.
//
// Claim model: a project's substantive fields are claims. Asserting a new claim
// for a single-valued field supersedes the prior active claim of that field
// (the old claim row is kept, flagged 'superseded' — nothing is deleted).
// Categories are multi-valued and live in pm_project_category.

import { db } from '../db.js';
import { allEvents } from './eventstore.js';
import { initProjections, dropProjections } from './schema.js';

const SINGLE_VALUED = new Set(['name', 'status', 'ticker', 'rank', 'description', 'website', 'launch_date', 'policy_id']);

function touchProject(id, seq) {
  db.prepare('UPDATE pm_project SET last_seq = ? WHERE id = ?').run(seq, id);
}

export function apply(ev) {
  const { seq, type, payload: p, ts } = ev;
  switch (type) {
    case 'source.registered':
      db.prepare(`INSERT INTO pm_source (source_id, kind, authority_class, url, captured_at, archive_wayback_url, archive_sha256, label, registered_seq)
                  VALUES (@source_id,@kind,@authority_class,@url,@captured_at,@archive_wayback_url,@archive_sha256,@label,@seq)
                  ON CONFLICT(source_id) DO UPDATE SET kind=excluded.kind, authority_class=excluded.authority_class,
                    url=excluded.url, captured_at=excluded.captured_at, archive_wayback_url=excluded.archive_wayback_url,
                    archive_sha256=excluded.archive_sha256, label=excluded.label`).run({
        source_id: p.source_id, kind: p.kind ?? null, authority_class: p.authority_class ?? null,
        url: p.url ?? null, captured_at: p.captured_at ?? null, archive_wayback_url: p.archive_wayback_url ?? null,
        archive_sha256: p.archive_sha256 ?? null, label: p.label ?? null, seq,
      });
      break;

    case 'category.added':
      db.prepare(`INSERT INTO pm_category (slug, name, source_id, as_of, taxonomy_note, deprecated, alias_of, added_seq)
                  VALUES (@slug,@name,@source_id,@as_of,@taxonomy_note,0,@alias_of,@seq)
                  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, source_id=excluded.source_id,
                    as_of=excluded.as_of, taxonomy_note=excluded.taxonomy_note`).run({
        slug: p.slug, name: p.name ?? null, source_id: p.source_id ?? null, as_of: p.as_of ?? ts,
        taxonomy_note: p.taxonomy_note ?? null, alias_of: p.alias_of ?? null, seq,
      });
      break;

    case 'category.deprecated':
      db.prepare('UPDATE pm_category SET deprecated = 1, alias_of = COALESCE(?, alias_of) WHERE slug = ?')
        .run(p.alias_of ?? null, p.slug);
      break;

    case 'project.imported':
    case 'project.proposed':
      db.prepare(`INSERT INTO pm_project (id, kind, unclassified, created_seq, last_seq)
                  VALUES (?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET kind=COALESCE(excluded.kind, pm_project.kind), last_seq=excluded.last_seq`)
        .run(p.id, p.kind ?? 'project', seq, seq);
      break;

    case 'claim.asserted': {
      const claimId = `clm_${seq}`;
      if (SINGLE_VALUED.has(p.field)) {
        db.prepare(`UPDATE pm_claim SET state='superseded', superseded_by_seq=? WHERE project_id=? AND field=? AND state='active'`)
          .run(seq, p.project_id, p.field);
      }
      db.prepare(`INSERT INTO pm_claim (claim_id, project_id, field, value, source_id, authority_class, as_of, asserted_by, state, asserted_seq)
                  VALUES (?,?,?,?,?,?,?,?, 'active', ?)`).run(
        claimId, p.project_id, p.field, p.value == null ? null : String(p.value),
        p.source_id ?? null, p.authority_class ?? null, p.as_of ?? ts, p.asserted_by ?? null, seq,
      );
      (p.evidence || []).forEach((e, i) => {
        db.prepare(`INSERT INTO pm_evidence (evidence_id, claim_id, kind, ref, sha256, description, attached_seq)
                    VALUES (?,?,?,?,?,?,?)`).run(
          `ev_${seq}_${i}`, claimId, e.kind ?? null, e.ref ?? null, e.sha256 ?? null, e.description ?? null, seq);
      });
      // denormalize convenience fields onto the project projection
      if (p.field === 'name') db.prepare('UPDATE pm_project SET name=?, last_seq=? WHERE id=?').run(String(p.value), seq, p.project_id);
      else if (p.field === 'status') db.prepare('UPDATE pm_project SET status=?, last_seq=? WHERE id=?').run(String(p.value), seq, p.project_id);
      else touchProject(p.project_id, seq);
      break;
    }

    case 'category.assigned':
      db.prepare(`INSERT INTO pm_project_category (project_id, category_slug, source_id, authority_class, as_of, state, asserted_seq)
                  VALUES (?,?,?,?,?, 'active', ?)
                  ON CONFLICT(project_id, category_slug) DO UPDATE SET source_id=excluded.source_id,
                    authority_class=excluded.authority_class, as_of=excluded.as_of, state='active', asserted_seq=excluded.asserted_seq`)
        .run(p.project_id, p.category_slug, p.source_id ?? null, p.authority_class ?? null, p.as_of ?? ts, seq);
      db.prepare('UPDATE pm_project SET unclassified=0, last_seq=? WHERE id=?').run(seq, p.project_id);
      break;

    case 'claim.superseded':
      db.prepare(`UPDATE pm_claim SET state='superseded', superseded_by_seq=? WHERE claim_id=?`).run(seq, p.claim_id);
      break;

    case 'challenge.opened':
      db.prepare(`INSERT INTO pm_challenge (challenge_id, target_claim_id, target_project_id, actor, grounds, state, opened_seq)
                  VALUES (?,?,?,?,?, 'open', ?)`).run(
        `ch_${seq}`, p.target_claim_id ?? null, p.target_project_id ?? null, p.actor ?? null, p.grounds ?? null, seq);
      if (p.target_claim_id) db.prepare(`UPDATE pm_claim SET state='contested' WHERE claim_id=? AND state='active'`).run(p.target_claim_id);
      break;

    default:
      // Unknown event types are preserved in the log but ignored by this
      // reducer version (forward-compatible).
      break;
  }
}

/** Drop and rebuild the entire read-model from the event log. */
export function rebuildProjections() {
  dropProjections();
  initProjections();
  let n = 0;
  for (const ev of allEvents()) { apply(ev); n++; }
  return n;
}
