# Builders Fund → Project Memory → Data Layer integration

**Status:** research + design, v1. **Design only — NO code, NO schema changes.**
**Date:** 2026-06-08.
**Question this document answers:** How could a Cardano **Builders Fund** (a builder/grant program) connect to the existing **Project Memory + Data Layer** so that builder/project pages display a project's **category, profile, provenance, and ecosystem links** — using ONLY infrastructure that is already built?
**Authoritative references:** `CARDANO_DATA_LAYER.md` (the layer), `service/src/modules/project.js` + `service/src/projectmemory/*` (the event-sourced Project Memory, read-only), `observatory/docs/PROJECT_MEMORY_GOVERNANCE_MODEL.md` and `PROJECT_MEMORY_IMPLEMENTATION_PLAN.md` (the deferred write/governance side), `CARDANO_API_REGISTRY.md` (the broader source map).
**Boundary discipline:** This proposes **no new endpoints, no schema changes, no write path**. It maps a Builders Fund onto the read-only surface that exists today, and is explicit about what is deferred to a future governed write path (§5) and what simply cannot be done yet (§6).

---

## 1. What a Cardano Builders Fund is (brief, sourced)

"Builders Fund" is the generic name for Cardano's **builder/grant programs** — mechanisms that give ADA (or fiat) to teams building on Cardano, staged by project maturity:

- **Project Catalyst** — the community-voted grant program; Cardano's flagship "innovation grants to build on Cardano," reported to have distributed on the order of $150M+ across 2,000+ funded proposals via community voting. Funds early ideas and MVPs with milestone-based payouts. ([projectcatalyst.io](https://projectcatalyst.io/), [Cardano Developer Portal — Funding](https://developers.cardano.org/docs/get-started/funding/))
- **Cardano Builder DAO / "builder growth" programs** — smart-contract-governed, KPI-based funding for projects with **demonstrated traction**, on recurring (e.g. six-month) rounds. Example proposal: GROW3DGE "Builder Growth Program for Cardano Builders." ([Catalyst Fund 15 — GROW3DGE](https://projectcatalyst.io/funds/15/cardano-open-ecosystem/grow3dge-builder-growth-program-for-cardano-builders))
- **Treasury Withdrawals** — on-chain governance funding for mature, high-impact projects, approved by DReps + the Constitutional Committee (the Observatory already covers this flow). ([Cardano Developer Portal — Funding](https://developers.cardano.org/docs/get-started/funding/))
- **Ecosystem / strategic funds** — e.g. the Draper Dragon "Orion Fund" ($80M, RWAs / institutional DeFi / Bitcoin-Cardano infra), administered with the Cardano Foundation. ([Cardano Foundation — Orion Fund](https://cardanofoundation.org/blog/orion-fund-initial-phase), [Flagship.FYI](https://flagship.fyi/outposts/blockchains/20-million-usd-in-grants-to-builders-on-cardano/))

**What matters for this integration:** every one of these programs produces, as a by-product, a list of **funded projects** — each with at minimum a *name*, usually a *description*, often a *website/socials*, and sometimes a *category/challenge tag* and an *on-chain identifier* (policy ID / script / token). That funded-project list is the connection point. The Builders Fund is the **source of the project's funding fact**; Project Memory is where that project's **identity, category, profile, and provenance** already live (or could be referenced).

Critically, the Builders Fund does **not** need to build its own project-profile store. The "moat" — curated project identity + category + provenance + history — is exactly the gap the Data Layer's Project Memory was built to fill (`CARDANO_DATA_LAYER.md` §3, the UNIQUE + PERISHABLE editorial layer). A builder page should **consume** that, not re-implement it.

---

## 2. The integration model: `Builders Fund → Project Memory → Data Layer`

```
  Builders Fund                 Project Memory (read-only)            Builder/Project page
  (Catalyst / Builder DAO /     event-sourced; projections                (ecosystem.html /
   Treasury / Orion …)          served by the Data Layer                   category.html / a
                                                                           builder profile view)
  ┌───────────────────┐         ┌──────────────────────────┐         ┌────────────────────────┐
  │ funded project:   │         │ pm_project (id/slug)      │         │  Category badge        │
  │  name             │ ─match─▶ │  ├─ claims (name, desc,  │ ─read─▶ │  Profile (desc, links) │
  │  [description]    │  (§4)    │  │   website, status,…) │  GET    │  Provenance (_quality, │
  │  [website/socials]│         │  ├─ category assignments │  /…     │    source, evidence)   │
  │  [on-chain id]    │         │  └─ provenance + history  │         │  Ecosystem links       │
  │  [category/tag]   │         │     (per claim)           │         │   (→ category, token)  │
  └───────────────────┘         └──────────────────────────┘         └────────────────────────┘
        SOURCE OF                  IDENTITY + CATEGORY +                  PRESENTATION
        FUNDING FACT               PROFILE + PROVENANCE                   (no new backend)
```

The chain is deliberately three hops with one rule per hop:

1. **Builders Fund → Project Memory id.** A funded project's name (and, where available, on-chain id) **resolves to a Project Memory `project` id/slug**. This is the matching problem (§4). The Builders Fund owns the funding fact; it does *not* own the project identity.
2. **Project Memory id → curated record.** Given the id, the project's **category, profile fields, provenance, and history are already served** by the read-only Project Memory API (`project.js`). Nothing new is computed; these are existing projections over the event log, with provenance first-class on every claim (`read.js → shapeClaim`).
3. **Curated record → page.** The builder/project page renders category + profile + provenance + ecosystem links **purely from those existing responses**. The page is a *client*; the backend stays read-only and untouched.

This respects the architecture's two non-negotiables:
- **Separate trust boundaries** — the funding fact (Builders Fund) and the curated identity (Project Memory) stay distinct; the page joins them at display time, it does not merge the stores (`CARDANO_DATA_LAYER.md` Boundary; governance §0).
- **Read-only today** — `project.js` exposes reads only; adding a builder's project as a *new* curated record is a write and is deferred (§5).

---

## 3. Exactly which existing endpoints a builder page calls

All of these exist today in `service/src/modules/project.js` (verified against the route table at the bottom of that file). No new endpoint is required for the read path.

### 3.1 Resolve + profile + provenance — `GET /project/:id`

The primary call. Returns the full curated record for one project, assembled by `read.js → getProject`:

- **Profile fields** — `fields` is an object keyed by field name (`name`, `status`, `description`, `website`, `ticker`, `rank`, …); each is an array of **claims** (subjective fields may legitimately hold more than one, per governance §1.4).
- **Per-field provenance** — every claim carries `provenance: { asserted_by (WHO), source (WHERE), authority_class, as_of (WHEN), evidence[] (WHAT EVIDENCE) }` (`read.js → shapeClaim`). `source` is expanded via `sourceOf()` to `{ source_id, kind, authority_class, url, captured_at, archive_wayback_url, archive_sha256, label }` — i.e. the chain-of-custody back into the preservation archive. `evidence[]` entries are `{ kind, ref, sha256, description }` (`evidenceFor()`).
- **Category** — `categories[]`, each `{ slug, name, authority_class, as_of, source }` (active assignments only).
- **History signal** — `superseded_claim_count`, `created_seq`, `last_seq` (the spine of the append-only history; full history is a separate call, §3.4).
- **Data-quality envelope** — every response is wrapped by `wrap()` → `dq()`, attaching the module-level `_quality` block: `{ source: 'project-memory', authority_class: 'D', refresh: 'static', provenance: 'Project Memory — event-sourced, seeded from cardano-project-memory-archive', as_of }`. **404** returns the same envelope with `confidence: 'low'` — so a no-match is itself an honest, machine-readable signal (§4).

**This single call supplies category + profile + provenance** for a matched builder project.

### 3.2 Category page + ecosystem siblings — `GET /category/:slug`

For the **category badge → category.html** ecosystem link, and for "other projects in this category." Returns `{ category: { slug, name, deprecated, alias_of, source_id, as_of, taxonomy_note }, project_count, projects[] }`, where each member carries its own `assignment: { authority_class, as_of, source_id }` (`categoryHandler`). The page links the project's category badge to this view; the response is the sibling list.

### 3.3 Matching by name/substring — `GET /project/search?q=` (and `GET /projects?q=`)

The resolver (§4). `GET /project/search?q=<name>` runs a substring match over project id **and** name (`projectSearchHandler` → `listProjects` `WHERE p.id LIKE ? OR p.name LIKE ?`), returning `{ q, total, count, projects[] }`. `GET /projects` is the same list endpoint and also accepts `q`, plus `status`, `category`, `limit`, `offset` filters (`listProjects`). Use search to map a Builders-Fund project name to a candidate `id`; use the filtered list to browse.

### 3.4 Full provenance history — `GET /history/:project`

For a "provenance / history" panel: the append-only, hash-chained event log for one project — `{ project, count, events[] }`, each event `{ seq, ts, type, actor, payload, hash, prev_hash }` (`historyHandler` → `historyForProject`). This is the deepest provenance view (when/how each claim entered), and the `hash`/`prev_hash` make it tamper-evident.

### 3.5 Taxonomy context (optional) — `GET /categories`

For rendering a category's coverage state honestly: `GET /categories` returns every category with `status` ∈ `populated | pending | deprecated` and a coverage summary (`categoriesHandler`). Useful so a builder page never implies a category is richer than it is.

### Mapping summary

| Builder-page element | Existing endpoint | Field(s) consumed |
|---|---|---|
| **Category** badge | `GET /project/:id` (→ link to `GET /category/:slug`) | `categories[].{slug,name,authority_class,as_of,source}` |
| **Profile** (desc, links, status) | `GET /project/:id` | `fields.{description,website,status,name,…}[].value` |
| **Provenance** (`_quality` + claim evidence/source) | `GET /project/:id` | top-level `_quality`; per-claim `provenance.{source,evidence,as_of,asserted_by,authority_class}` |
| **Provenance — full history** | `GET /history/:project` | `events[]` (hash-chained) |
| **Ecosystem link → category.html** | `GET /category/:slug` | `category` + sibling `projects[]` |
| **Ecosystem link → token** | `GET /project/:id` | `fields.ticker` / a `token`-kind project id (`kind: 'token'`, e.g. `tt:<TICKER>`) — link to ecosystem.html token view |
| **Resolver (name → id)** | `GET /project/search?q=` / `GET /projects?q=` | `projects[].id` |

**Ecosystem links, concretely.** The Data Layer already distinguishes `kind: 'project'` from `kind: 'token'` on `pm_project` (`schema.js`), and tokens carry a `ticker` claim (the TapTools-seeded `tt:<TICKER>` records). So a builder page can link:
- the **category badge** → `category.html?slug=<categories[].slug>` (backed by `GET /category/:slug`);
- a **token** → the ecosystem.html token view when the project has a `ticker` field or a sibling `kind:'token'` record with the same ticker;
- **sibling projects** → their own builder/project views via `projects[].id` from the category response.

No new join table is needed for these — they are all derivable from fields already present in the existing responses.

---

## 4. The matching problem (Builders-Fund name → Project Memory id)

This is the only genuinely hard part of the read integration, because a Builders-Fund proposal title is free text and a Project Memory `id` is a curated slug. Three resolution strategies, in descending confidence, plus the honest no-match path.

### 4.1 Resolution ladder

1. **Exact id / slug match (highest).** If the Builders-Fund record already carries a known Project Memory id (or its slug can be derived deterministically and confirmed), call `GET /project/:id` directly. A `200` is a confident match; a `404` is a confident *no* (envelope `confidence: 'low'`). Best case — used whenever a curated mapping exists (§4.2) or the project self-identifies.
2. **On-chain identifier match (high, when present).** Where the Builders-Fund record includes an on-chain id (policy ID / script / token) and Project Memory holds the same identifier as a Class-A claim, that is the strongest possible match — on-chain ids are objective and reproducible (governance §3.4 evidence ladder; authority class A). *Today this is mostly aspirational:* the current seed (`seed.js`) carries on-chain ids only implicitly via `tt:<TICKER>` token records, not as first-class policy-ID claims, so this path is real in design but thin in current data (§6).
3. **Name / substring search (medium, fuzzy).** Call `GET /project/search?q=<normalized name>`. Treat results as **candidates, not answers**: a single high-similarity hit can be auto-linked with a visible "matched by name" provenance note; multiple or weak hits should be surfaced as "possible matches," never silently collapsed to one. This is the realistic default for most legacy funded projects today, and it is explicitly **fuzzy** — the page must label it as such.

### 4.2 The future curated mapping (the right long-term answer)

The durable solution is a **curated `builders-fund-project → project-memory-id` mapping**, itself a provenance-bearing record: who asserted the mapping, from which fund/round, with what evidence (the proposal URL, the on-chain id). This is a **write** into the curated layer and therefore belongs to the deferred governed write path (§5), not to today's read-only system. Until it exists, strategies 1–3 above carry the load, with strategy 3 the fallback.

### 4.3 Handling no-match honestly

The system must **never fabricate a profile** for an unmatched builder project. Honest behaviours, all already supported by the existing surface:

- **`404` is a first-class answer.** `GET /project/:id` on an unknown id returns the data-quality envelope with `confidence: 'low'` — the page renders "No curated Project Memory record found for this builder project" and shows *only* the funding fact it got from the Builders Fund, attributed to the Builders Fund as source.
- **Ambiguous search → disclosed candidates.** If `GET /project/search` returns several, show them as candidates with their ids and let a human (or a future curator) confirm; do not auto-pick.
- **Unclassified is shown, not guessed.** A matched project with no category assignment carries `unclassified: true` / empty `categories[]` (governance §3.5: "surfaced as `unclassified`, never guessed"). The badge reads "Uncategorized," not a guessed category.
- **Provenance of the match itself is disclosed.** Whether the link came from an exact id, an on-chain id, or a fuzzy name match is shown on the page, so a fuzzy match is never presented with the same confidence as an exact one.

This keeps the integration aligned with the layer's core promise: **provenance over authority, no guessing, disclosed confidence** (governance §1).

---

## 5. What is needed LATER (deferred — explicitly NOT now)

Everything in §§2–4 above is achievable **read-only**, against endpoints that already exist. The following require a **governed write path** and are deferred to the architecture already designed in `PROJECT_MEMORY_GOVERNANCE_MODEL.md` + `PROJECT_MEMORY_IMPLEMENTATION_PLAN.md`. **None of this is to be built now**, and **no schema change is proposed here.**

1. **Adding a builder's project as a curated record.** When a funded project isn't yet in Project Memory, creating it is a write. Per the governance model it is a `project.proposed` / `project.imported` event with a provenance threshold (governance §3.1): a Builders-Fund import would be a **Class D community import** (`machine-imported` + source = the fund), or, if the team self-attests via CIP-72 / signed message, a **Class B self-add**. The implementation plan already names these events (`project.imported`, `claim.asserted`) and the actor kinds (automated agent for imports; project owner for self-attestation) (`PROJECT_MEMORY_IMPLEMENTATION_PLAN.md` §§2, 5).
2. **Category assignment with provenance.** Assigning a funded project to a category is a `category.assigned` claim carrying `source`, `authority_class`, `as_of`, `evidence` — exactly the shape the Built-on-Cardano seed already emits (`seed.js` `category.assigned`). Doing it *live* (not at seed time) is the deferred write side; the read side (§3.2) already serves the result.
3. **A "Builders Fund" source registry entry.** Each fund (Catalyst, Builder DAO, Orion, …) would be registered as a `pm_source` via `source.registered` with its own `authority_class` and `url`, so every funding-derived claim traces to the fund (mirrors how `cardanocube`, `taptools-wayback`, `builtoncardano` are registered in `seed.js`). Design-only today.
4. **The curated funding↔id mapping (§4.2)** as a first-class, provenance-bearing record — itself a governed write.
5. **Self-attestation path for builders.** A funded team proving control of its on-chain identifier (CIP-72 / signed message) to authoritatively set its self-describing fields (governance §3.2, roles table "Project owner"). This is the strongest provenance and the cleanest match (§4.1 rung 2), but depends on the deferred write path **and** on CIP-72 adoption (an open question in both governance §7 and the API registry §4).

The governance model is explicit that the write side is *deliberately not built yet* — `project.js`'s header says so directly ("Adding/updating/challenging metadata … is deliberately not built yet"), and the implementation plan's §0 lists production moderation / editing UI / accounts / taxonomy editor as non-goals. A Builders Fund integration **inherits that boundary**: read now, write later under governance.

---

## 6. Honest gaps

- **Data coverage is the binding constraint, not the API.** The read endpoints exist and are sufficient — but Project Memory today is seeded from cardanocube (defunct/"graveyard" projects), TapTools Wayback rankings, and Built-on-Cardano (`seed.js`). It is **not** seeded from any Builders Fund. So most *currently funded* builder projects will **not** have a Project Memory record yet, and §4 will frequently fall to the fuzzy path or to a clean `404`. The integration is sound; the dataset is sparse for this use case until the deferred import (§5.1) runs.
- **On-chain id matching is thin in current data.** The strongest match rung (§4.1.2) needs first-class policy-ID / script claims; the present seed carries on-chain identity only implicitly via `tt:<TICKER>` token records. Until on-chain ids are imported as Class-A claims, §4 leans on names.
- **Fuzzy name matching is genuinely lossy.** Catalyst proposal titles, marketing names, and curated slugs diverge (rebrands, "Project X by Team Y" vs "X"). `LIKE`-based substring search (`read.js`) will miss and mis-hit; there is no fuzzy/normalized matching in the existing endpoint. This is acceptable *only* because no-match is handled honestly (§4.3) — but it caps automatic match rate.
- **No live Builders Fund API to pull from.** Catalyst has no programmatic API (CSV/PDF result files only; `CARDANO_API_REGISTRY.md` §6); Catalyst Explorer (Lido Nation) is the best aggregator but single-operator with unverified endpoints. So the *Builders-Fund side* of the join is itself a preservation/scraping problem (it overlaps the FLOW-6 / IdeaScale capture work), independent of the Data Layer.
- **`_quality.authority_class` is module-level `D`.** The envelope reports a single `D` for the whole Project Memory module (`project.js` `DQ`), while individual claims carry their own per-claim `authority_class` (B for Built-on-Cardano, C for TapTools, D for cardanocube). A builder page should read **per-claim** authority for accuracy and treat the module-level `D` as a floor, not the truth for every field.
- **Category data is partial.** `GET /categories` exposes `populated | pending | deprecated`; many categories are `pending` (empty). A builder project may match a real category that simply has no other members yet — the page should show that honestly rather than imply an empty category is an error.
- **Taxonomy mismatch.** A Builders Fund's own challenge/category tags (Catalyst "challenges," Builder DAO KPIs) are a *different taxonomy* from cardanocube's ~74 categories. Mapping fund-tags → Project Memory categories is a curation decision (governance §3.5, per-source taxonomy preserved as-found; canonical taxonomy never a silent merge) — deferred, not automatic.

---

## 7. One-paragraph verdict

A Cardano Builders Fund can light up rich builder/project pages — **category, profile, provenance, ecosystem links** — with **zero new backend**: resolve each funded project to a Project Memory `id` (exact/on-chain/fuzzy, §4), then read `GET /project/:id` (profile + per-claim provenance + `_quality`), `GET /category/:slug` (category + ecosystem siblings), and `GET /history/:project` (full provenance trail) — all already shipped and read-only (`service/src/modules/project.js`). The honest limits are **data coverage** (Project Memory isn't seeded from any fund yet) and **matching fidelity** (substring-only, no on-chain ids in seed), both handled transparently by treating a `404`/ambiguous result as a first-class, disclosed outcome rather than a guess. Everything that would *write* a builder's project, category, source, or funding↔id mapping into the curated layer is **deferred to the existing governed write path** (`PROJECT_MEMORY_GOVERNANCE_MODEL.md` / `_IMPLEMENTATION_PLAN.md`) and is explicitly **not built now** — and **no schema change is proposed**.

---

### Sources
- [Project Catalyst](https://projectcatalyst.io/) · [Cardano Developer Portal — Funding](https://developers.cardano.org/docs/get-started/funding/) · [Catalyst Fund 15 — GROW3DGE Builder Growth Program](https://projectcatalyst.io/funds/15/cardano-open-ecosystem/grow3dge-builder-growth-program-for-cardano-builders) · [Cardano Foundation — Orion Fund](https://cardanofoundation.org/blog/orion-fund-initial-phase) · [Flagship.FYI — $20M grants to builders](https://flagship.fyi/outposts/blockchains/20-million-usd-in-grants-to-builders-on-cardano/)
</content>
</invoke>
