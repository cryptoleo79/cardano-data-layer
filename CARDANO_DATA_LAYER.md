# Cardano Data Layer

**Status:** research synthesis, v1.
**Date:** 2026-06-03.
**Question this document answers:** Is a neutral Cardano **data-infrastructure layer** — Token Metadata API + Project Metadata API + Category API — a genuine ecosystem gap, or a redundant TapTools clone?
**Companion documents:** `TAPTOOLS_API_GAP_ANALYSIS.md` (what live API capability is orphaned), `MVP_REPLACEMENT_BLUEPRINT.md` (the minimal replacement design).
**Boundary:** This is the Cardano **Data Layer** (live, queryable infrastructure). It is distinct from the Cardano **Memory Layer** (archival preservation; FLOW-6 Catalyst archive + Project Memory archive). The Data Layer *consumes* the Memory Layer as a seed source but is a separate trust boundary and a separate product.

---

## The thesis in one line

The orphaned **market data** (prices, OHLCV, floors, liquidity) is mostly reproducible from open sources and is therefore a *commodity* rebuild. The orphaned **editorial data** (project descriptions, classifications, launch dates, audit status, category state) is **not reproducible from any open source**, is **perishable**, and is therefore the *only* part that justifies new neutral infrastructure rather than a clone.

---

## The six questions

### 1. What data disappears with TapTools?

Two layers disappear simultaneously, with very different recoverability:

- **Market/analytics layer (recoverable):** token spot prices, OHLCV/historical charts, market caps, DEX liquidity & volume, NFT floor prices & volume, wallet/portfolio valuations. Named explicitly in shutdown coverage as the developer-facing loss. Reconstructable from DEX APIs + on-chain indexers + OpenCNFT (see gap analysis §3).
- **Editorial/index layer (largely unrecoverable):** TapTools' curated token lists, the *historical ranking state* (what ranked where, when), and per-asset editorial overlays. The live API never exposed historical category/ranking state; the only record is the Wayback Machine's incidental snapshots — which is precisely why the Memory Layer captured the pre-SPA ranking grids.

### 2. What APIs are people actively seeking replacements for?

The orphaned **HIGH-demand** consumers (ranked, from real dependence signals): token price + OHLCV → market cap → DEX liquidity/volume → token holders/distribution → NFT floor/volume → wallet/portfolio. Documented production dependents include DexHunter (the leading DEX aggregator), Flux Point Studios, WAVE Digital Assets, trading bots, and an AI/MCP tooling layer. No direct replacement has been announced — the search is live and immediate.

### 3. Which datasets are unique?

**Unique = editorial/curated, not derivable from chain or registries:**
- Project descriptions, team, socials, audit status, founding/launch date.
- Project → category assignments and the category taxonomy itself.
- The *historical state* of any of the above (what a project's description/category was before it pivoted or died).

These live today only as **scrapeable websites** (cardanocube), **thin/rate-limited APIs** (builtoncardano: `logo/name/industries/description/link`, ~1k req/day, no audit/date/team), or **commercial silos** (TapTools, now closing). No open, comprehensive API serves them.

### 4. Which datasets are reproducible?

**Reproducible = derivable from open sources:**
- Token off-chain metadata — CIP-26 registry already has an open consolidated API (`tokens.cardano.org/metadata`, batch query) re-served by Koios/Blockfrost; CIP-25/68 is on-chain.
- Token holders, supply — Koios/Blockfrost.
- NFT floor/volume/sales/distribution — OpenCNFT.
- Token price/OHLCV/mcap/liquidity — *assemblable* from Minswap/DexHunter quotes + on-chain supply (mechanical, but you must persist the time series).

### 5. Which datasets become impossible to reconstruct later?

**Perishable / impossible-to-reconstruct-after-the-fact:**
- A **dead project's** description, socials, team, and audit history — vanish when the site and its Twitter go down. There is no git-versioned canonical source for most of it. (This is exactly what the Memory Layer just pinned for the 20 cardanocube "graveyard" projects.)
- **Historical category/ranking state** — what was classified as what, and what ranked where, at a point in time. No versioned public store exists; once the source updates or dies, the prior state is gone unless it was snapshotted.
- **Live price/OHLCV history that is never snapshotted** — if no one is persisting a token's candle history now, the gap in the record cannot be backfilled later (DEX trade events survive on-chain but consolidated cross-DEX OHLCV must be computed continuously).

The durable datasets, by contrast: CIP-26 (git history), on-chain CIP-25/68 (permanent), and anything else fully on-chain.

### 6. What is the minimum viable API?

See `TAPTOOLS_API_GAP_ANALYSIS.md` §5 and `MVP_REPLACEMENT_BLUEPRINT.md`. In short: a token price/OHLCV/mcap/rankings core (the engineering), thin proxies for holders + metadata + NFT (cheap wins), and a curated project/category layer (the moat).

---

## Verdict on the three proposed APIs

| Proposed API | Genuine gap? | Uniqueness | Time-sensitivity | Recommendation |
|---|---|---|---|---|
| **Token Metadata API** | **No / weak** | REPRODUCIBLE | DURABLE | An open consolidated API already exists (`tokens.cardano.org/metadata` + Blockfrost); on-chain CIP-25/68 is trustless. Building here = redundant. **Include only as a thin passthrough**, not as a product. |
| **Project Metadata API** | **Yes — strong** | UNIQUE (curated) | PERISHABLE | Best data is website-only/commercial; the one open API (builtoncardano) is thin & rate-limited; DefiLlama is DeFi-only. Audit status, launch date, team, on-chain IDs are not available in aggregate anywhere open. |
| **Category / Taxonomy API** | **Yes — strongest wedge** | UNIQUE (curated) | PERISHABLE | **No** open ecosystem-wide Cardano category API exists at all. cardanocube's ~74 categories are website-only; builtoncardano tags and DefiLlama categories are partial/non-canonical. A small, openly-licensed, versioned category API would be a first-of-kind neutral primitive. |

**Strongest candidate for a minimal neutral data-infrastructure layer:** the **Category / Taxonomy API as the entry wedge, backed by a thin Project Metadata core.** It scores worst on availability (nothing open exists) and best on need; it is UNIQUE + PERISHABLE (the combination that justifies infrastructure rather than a product); and it is genuinely neutral — it doesn't compete with prices (TapTools) or TVL (DefiLlama), it provides the missing *classification substrate* that wallets, explorers, and aggregators could all consume.

**Token Metadata should be explicitly out of scope** (or a thin proxy to the existing official API) to keep the layer neutral and avoid duplicating solved infrastructure.

---

## Why this is a data-infrastructure layer, not a TapTools clone

- A **clone** would lead with prices/charts/portfolio (the trader-facing product). That is the *commodity, reproducible* layer — and competing there means perpetually re-deriving DEX data with no moat.
- An **infrastructure layer** leads with the *unique, perishable* classification + project-identity data that nothing serves openly, exposes it under an open license with a versioned history, and treats market data as a thin convenience layer over existing open sources.
- The market layer is the **on-ramp** (it re-floats the orphaned HIGH-demand consumers quickly); the editorial layer is the **moat** (it is the part no one else can cheaply reproduce, and the part that is being permanently lost right now).

## Alignment with existing standards (so it is neutral, not yet-another-silo)

- **CIP-26** — token-metadata passthrough.
- **CIP-72** (dApp Registration & Discovery) — on-chain anchoring of project identity; reference impl by Cardano-Fans (CRFA).
- **CRFA off-chain data registry / Strica contracts registry** — script-hash → dApp + audit/label mappings.
- **CIP-52** — audit best-practice semantics (note: per-project audit *status* is not captured in any open API today — a gap the Project Metadata layer could fill).

## Relationship to the Memory Layer (seed, not dependency)

The Cardano Memory Layer archive already preserves the bootstrap dataset for the editorial layer:
- cardanocube taxonomy (~74 categories) + the 20 "graveyard" dead-project profiles (wayback-pinned, this session).
- TapTools pre-SPA historical ranking grids (mirrored) + the 2,224-URL historical-project-metadata index.

Per the separate-trust-boundary principle, the Data Layer would **reference** these as a seed source under chain-of-custody, not entangle the two systems. The archive proves provenance; the Data Layer serves the live, curated, forward-maintained view.

---

## Open questions before any build commitment

1. **Who maintains the editorial curation?** The moat is also the maintenance burden. A category/project API is only as good as its ongoing curation. Is there an operator/community model, or does it decay like every prior directory? — *A governance model now answers the add/update/challenge/dispute/taxonomy/history questions: see `observatory/docs/PROJECT_MEMORY_GOVERNANCE_MODEL.md`. The funding/maintainer-recruitment piece of this question remains open (tracked there).*
2. **Licensing & neutrality.** Open license (the differentiator vs TapTools/builtoncardano) — but cardanocube's content is "All rights reserved"; the seed must be re-curated/attributed, not republished wholesale.
3. **Sustainability vs the thing it replaces.** TapTools shut down *despite* being "fast, cost-effective." A neutral infra layer needs a funding/governance model (Catalyst? foundation grant? public good?) that doesn't repeat the failure.
4. **Scope discipline.** The temptation is to creep into a full TapTools clone. The discipline is: thin proxies for the commodity layer, real investment only in the unique/perishable layer.
