# TapTools Moat Analysis — what is actually hard to replace

**Status:** research synthesis, v1.
**Date:** 2026-06-07.
**Goal:** Extract the **moat** — the part of TapTools that is hardest (or impossible) to replace when the company goes dark — **not** a how-to-clone. The clone question is answered elsewhere (`TAPTOOLS_API_GAP_ANALYSIS.md` §5, `MVP_REPLACEMENT_BLUEPRINT.md`). This document isolates what justifies preservation/infrastructure rather than re-derivation.
**Method:** Capabilities enumerated directly from the preserved TapTools OpenAPI spec (`~/cardano-project-memory-archive/taptools-via-wayback/api/taptools-openapi-v2.0.5.json`, v2.0.5, **61 paths**, base `https://openapi.taptools.io/api/v1`, auth `x-api-key`). Reproducibility/source judgements cite the local registry and gap analyses.
**Companion docs:** `CARDANO_API_REGISTRY.md` (source map), `TAPTOOLS_API_GAP_ANALYSIS.md` (orphaned-demand ranking), `CARDANO_DATA_LAYER.md` (infrastructure thesis), `~/observatory/docs/MARKET_REALITY_RESEARCH.md` (signal-by-signal reliability).

The four questions asked of **every** bucket below:
- **Preserve?** — can we capture/keep the data (or a snapshot of it) before the API dies?
- **Expose?** — can we serve it through an API of our own (rights + technical feasibility)?
- **Public?** — can it be made openly licensed/redistributable, or is it locked?
- **Reproducible?** — can it be regenerated from open sources if we never captured it?

> **The shape of the answer up front.** Most of TapTools' 61 endpoints fall in buckets 1–2: reproducible from open Cardano sources (cheaply or expensively). Those are a *commodity rebuild*, not a moat. The moat is buckets 3–6: **perishable historical state** (price/OHLCV/ranking/category snapshots never captured) and **editorial curation** (descriptions, classifications, social links the platform *authored*). Bucket 7 (project/token identity) straddles — durable where on-chain/CIP-26-backed, perishable where it was TapTools' own overlay.

---

## The full 61-endpoint surface, mapped to buckets

Enumerated from the spec, grouped by tag, with the bucket each capability falls in.

### Onchain » Asset / Address / Transaction (4) — **Bucket 1**
`/asset/supply`, `/address/info`, `/address/utxos`, `/transaction/utxos`. Raw chain reads (supply, balances, UTxOs). Directly reproducible from Koios/Blockfrost/db-sync (registry §1).

### Integration (6) — **Bucket 1**
`/integration/asset`, `/integration/block`, `/integration/events`, `/integration/exchange`, `/integration/latest-block`, `/integration/pair`. CoinGecko/DEX-screener-shaped feed of asset/block/DEX-event/pair primitives. Reproducible from an indexer + DEX decoding.

### Market (2) — **Bucket 1 (live) / Bucket 3 (its history)**
`/metrics` (your own request counts — trivial), `/market/stats` (24h DEX volume + active addresses; the spec defines active addresses as stake-deduped 24h senders/receivers). The *live* number is reproducible from db-sync; the *historical daily series* is bucket 3 if nobody persists it.

### Market » Tokens (18)
- **Bucket 1/2 (price/OHLCV/mcap/rankings):** `/token/quote`, `/token/quote/available`, `/token/prices` (POST, batch ≤100, "aggregated across all supported DEXs"), `/token/prices/chg`, `/token/ohlcv` (aggregated across pools or per-pair), `/token/mcap`, `/token/pools`, `/token/trading/stats`, `/token/trades`, `/token/top/mcap`, `/token/top/volume`, `/token/top/liquidity`, `/token/indicators`. Spot price is bucket 1 (DEX quotes). **Cross-DEX aggregation, mcap, rankings are bucket 2** (expensive: indexing + the supply join). Notably, the spec admits `/token/mcap` pulls **circulating supply from `github.com/minswap/market-cap`** — i.e. TapTools itself depended on an *external open* source for the hardest field; that source survives TapTools.
- **Bucket 2 (holders):** `/token/holders` (stake-deduped count), `/token/holders/top`. Expensive but reproducible (Koios/Blockfrost `asset_addresses`; paging cost for huge tokens).
- **Bucket 2 (DeFi loans):** `/token/debt/loans`, `/token/debt/offers` (P2P loans/offers, Lenfi/Levvy). Reproducible only by decoding each lending protocol's contracts — expensive, low demand.
- **Bucket 4/7 (editorial):** `/token/links` — "social links **if they have been provided to TapTools**". This is curated/submitted editorial overlay, not chain data. See buckets 4 and 7.

### Market » NFTs (29)
Floor/volume/sales/stats/listings/holders/trades/rankings/traits/rarity, per-collection and market-wide: `/nft/collection/stats[/extended]`, `/nft/collection/info`, `/nft/collection/assets`, `/nft/collection/listings[/depth|/individual|/trended]`, `/nft/collection/ohlcv`, `/nft/collection/trades[/stats]`, `/nft/collection/volume/trended`, `/nft/collection/holders/{distribution|top|trended}`, `/nft/collection/traits/{price|rarity|rarity/rank}`, `/nft/asset/{sales|stats|traits}`, `/nft/market/{stats|stats/extended|volume/trended}`, `/nft/marketplace/stats`, `/nft/top/{timeframe|volume|volume/extended}`.
- **Bucket 1/2 (live):** floor/volume/sales/holders/listings — reproducible via OpenCNFT (purpose-built, open with attribution) or self-indexing marketplace contracts (registry §3; gap analysis §3 rates this **EASY**). Note `/nft/collection/info` also carries curated socials/description → **bucket 4 overlap**.
- **Bucket 3 (history):** NFT floor **OHLCV**, trended holders/listings/volume — perishable if not captured (no open source backfills cross-marketplace floor candles, and **jpg.store's API is already sunset**, registry §3).
- **Bucket 6 (rankings):** `/nft/top/*`, `/nft/marketplace/stats` — the *state of who ranked where* at a point in time.

### Wallet » Portfolio (3) — **Bucket 2**
`/wallet/portfolio/positions`, `/wallet/trades/tokens`, `/wallet/value/trended`. Holdings (chain) × the price layer. Reproducible but only *after* you've built the price/OHLCV layer; historical trended value is bucket 3 if not persisted.

**Tally:** ~50 of 61 endpoints are buckets 1–2 (reproducible). The moat is concentrated in the ~10 endpoints (and the *time dimension* of all of them) that touch editorial overlay, curated identity, and uncaptured history.

---

## Bucket 1 — Data easily reproducible

**Capabilities:** `/asset/supply`, `/address/info`, `/address/utxos`, `/transaction/utxos`, all `/integration/*`, `/token/quote[/available]`, `/token/prices`, `/token/prices/chg`, spot price within `/token/ohlcv`, `/token/pools`, live `/market/stats`, live NFT floor/volume/sales/listings, on-chain NFT supply. (Token off-chain metadata via CIP-26 also lands here.)

| Question | Answer |
|---|---|
| **Preserve?** | Not necessary — regenerable on demand. Worth snapshotting only as provenance. |
| **Expose?** | Yes — thin proxy/passthrough over Koios/Blockfrost/Minswap/DexHunter/OpenCNFT/CIP-26 (registry §1–3). |
| **Public?** | Yes — on-chain data carries no redistribution restriction; CIP-26 is free; OpenCNFT requires attribution. |
| **Reproducible?** | **Yes, cheaply.** Class A on-chain or first-party DEX/NFT APIs. Gap analysis rates these "cheap wins." |

**Moat content: none.** Competing here is "perpetually re-deriving DEX data with no moat" (`CARDANO_DATA_LAYER.md`).

---

## Bucket 2 — Data expensive but reproducible

**Capabilities:** cross-DEX **aggregated** price/OHLCV (`/token/ohlcv`, `/token/prices`), market cap/FDV (`/token/mcap`, `/token/top/mcap`), volume/liquidity rankings (`/token/top/volume`, `/token/top/liquidity`, `/token/trading/stats`, `/token/trades`), **holder count + distribution** (`/token/holders[/top]`), NFT holder distribution/trends, **cross-protocol DeFi loans** (`/token/debt/*`), **wallet/portfolio valuation** (`/wallet/*`), ecosystem-wide `/market/stats`.

| Question | Answer |
|---|---|
| **Preserve?** | The *method* is what you keep; the live values regenerate. |
| **Expose?** | Yes, but it is **real engineering**: cross-DEX consolidation, a persisted time series, the supply join, per-protocol contract decoding for loans. Gap analysis calls this "the core effort." |
| **Public?** | Yes — built from open sources, so output can be openly licensed. (Inputs like DexHunter have unverified redistribution terms — registry §2.) |
| **Reproducible?** | **Yes, at cost.** Mechanical multi-source joins + indexing. The one residue: aggregated cross-DEX OHLCV/mcap/holder distribution are the "hard residue" (registry cross-cutting #2). Mitigant: circulating supply for mcap comes from the **open** `minswap/market-cap` repo that TapTools itself used. |

**Moat content: weak and decaying.** Expensive ≠ unique. Whoever pays the indexing cost reproduces it. The only durable edge here is **operational** (uptime, breadth, the persisted series you start now) — and persistence pushes the genuinely valuable part into bucket 3.

---

## Bucket 3 — Data impossible to reconstruct later (perishable)

**This is where the moat begins.** The TapTools API is a *live* surface: it returns current values and computes history from its own indexer. It **never exposed an immutable archive** of past state. So anything time-stamped that nobody is persisting *now* is lost when the indexer dies.

**Capabilities (the perishable time dimension of otherwise-reproducible endpoints):**
- **Historical token price / OHLCV not captured now** — `/token/ohlcv`, `/token/prices/chg`. DEX *trade events* survive on-chain, but **consolidated cross-DEX OHLCV must be computed continuously**; a gap in the candle record cannot be backfilled (`CARDANO_DATA_LAYER.md` §5; MARKET_REALITY §1.2 USD-leg caveat).
- **Historical NFT floor OHLCV / trended holders / listings / volume** — `/nft/collection/ohlcv`, `/nft/collection/{holders,listings,volume}/trended`. Cross-marketplace floor candles have **no open backfill**, and **jpg.store is already gone** (registry §3) — the marketplace coverage TapTools had is itself shrinking.
- **Historical `/market/stats`** — the daily DEX-volume + active-address series.
- **Historical `/wallet/value/trended`** — only recomputable if the price layer's history existed at the time.

| Question | Answer |
|---|---|
| **Preserve?** | **Only by capturing snapshots from now on.** Past gaps are unrecoverable. This is a *clock-is-ticking* item. |
| **Expose?** | Yes, if/once captured — as an immutable, time-stamped archive (the Memory Layer pattern). |
| **Public?** | Yes — derived/observational facts can be openly licensed; tag third-party-priced legs as non-reproducible (MARKET_REALITY §0, §4.5). |
| **Reproducible?** | **No (after the fact).** This is the defining property: once the source updates or dies and no snapshot exists, the prior state is gone (`CARDANO_DATA_LAYER.md` §5). |

**Moat content: high — but mostly for state captured at observation time, not yet captured retroactively.** What *this project* already pinned (TapTools pre-SPA ranking grids, the CDX index) is exactly bucket-3/5/6 state frozen before the shutdown — see THE MOAT.

---

## Bucket 4 — Editorial metadata (curated descriptions / classifications)

**Capabilities:** `/token/links` (the spec is explicit: socials "**if they have been provided to TapTools**"), `/nft/collection/info` (curated name/description/Discord/Twitter/website/logo). These are not chain reads — they are content TapTools **authored or solicited and curated**. The token/NFT classification implied by TapTools' lists/sections (which token is "DeFi," which collection is featured) is the same class of editorial judgement.

| Question | Answer |
|---|---|
| **Preserve?** | Yes for *snapshots* (Wayback/site mirrors + the spec's example values). The live curated set behind the API dies with it unless mirrored before sunset. |
| **Expose?** | Yes if re-curated under our own custody; **not** wholesale republication (rights). |
| **Public?** | **Constrained.** TapTools' terms are unverified-assume-restricted (registry §2); CardanoCube, the richest external curated source, is "all rights reserved" (registry §4). Open seed candidates: CRFA registry (MIT) and Developer Portal showcase (MIT). The open future is CIP-72/CIP-72 + CRFA, but early/under-adopted. |
| **Reproducible?** | **No.** "Not derivable from chain or registries" (`CARDANO_DATA_LAYER.md` §3). It is human curation. Where a project's own site/Twitter is alive you can re-curate; where the project is dead, it is gone. |

**Moat content: high.** This is unique + perishable — the combination that justifies infrastructure, not a clone (`CARDANO_DATA_LAYER.md` verdict table).

---

## Bucket 5 — Historical category state (what was classified as what, when)

**Capabilities:** the *time-versioned* form of bucket 4's classifications — TapTools' category/section membership and token/collection taxonomy **as it stood at a past date**. The live API exposed *current* lists only; it never served "what category was project X in on date Y."

| Question | Answer |
|---|---|
| **Preserve?** | **Only via snapshots taken at the time.** No versioned store ever existed on the platform. |
| **Expose?** | Yes, as an append-only versioned classification archive (the Memory Layer is event-sourced precisely for this). |
| **Public?** | Yes for our *own* re-curated, versioned taxonomy; the seed (CardanoCube ~74 categories) is rights-restricted and must be re-curated/attributed, not republished (`CARDANO_DATA_LAYER.md` open-questions #2). |
| **Reproducible?** | **No.** "What was classified as what, and what ranked where, at a point in time. No versioned public store exists; once the source updates or dies, the prior state is gone unless it was snapshotted" (`CARDANO_DATA_LAYER.md` §5). |

**Moat content: highest tier.** Unique, perishable, and *no open ecosystem-wide Cardano category API exists at all* — the "strongest wedge" (`CARDANO_DATA_LAYER.md` verdict table).

---

## Bucket 6 — Historical rankings state (what ranked where, when)

**Capabilities:** the *time-versioned* form of every `top`/`stats` ranking — `/token/top/{mcap,volume,liquidity}`, `/nft/top/{timeframe,volume,volume/extended}`, `/nft/marketplace/stats`, `/market/stats`, plus the pre-SPA ranking grids the website rendered. The API returns *current* rankings; the *historical leaderboard at a past date* was never an endpoint.

| Question | Answer |
|---|---|
| **Preserve?** | **Only via snapshots.** This is exactly what the Project Memory archive captured from TapTools' **pre-SPA** (server-rendered) ranking pages, which were Wayback-snapshottable before the site became a JS SPA. |
| **Expose?** | Yes, as a dated, immutable rankings archive. |
| **Public?** | Yes for the observed-fact form ("on date Y, token X ranked Nth by mcap"), under the observability rule (MARKET_REALITY §0). |
| **Reproducible?** | **No after the fact.** Recomputable only if you persisted the underlying price/volume/mcap series at the time (bucket 3) — which the live API did not let you backfill. |

**Moat content: high, and partially already secured** — the pre-SPA grids are mirrored (see THE MOAT).

---

## Bucket 7 — Project metadata

**Capabilities:** the identity layer — `/token/links`, `/nft/collection/info`, and the implied per-asset project identity (name, ticker, description, socials, logo, launch, audit status, team). Spec evidence: `token_links_response` carries description + 10 social fields; `market_nft_collection_info` carries name/logo/supply/socials/description.

This bucket **straddles**:
- **Durable / reproducible part:** on-chain CIP-25/68 token metadata, CIP-26 off-chain registry (open consolidated API at `tokens.cardano.org/metadata`, re-served by Koios/Blockfrost), on-chain supply. → effectively **bucket 1**.
- **Unique / perishable part:** the *curated overlay* TapTools added (descriptions it wrote, socials submitted to it, audit status, launch date, team) — none of which is in any open aggregate. Audit *status* specifically "is not captured in any open API today" (`CARDANO_DATA_LAYER.md` alignment note re CIP-52). → **bucket 4**.

| Question | Answer |
|---|---|
| **Preserve?** | Durable part: no need (CIP-26 has git history; on-chain is permanent). Curated part: **snapshot now** — especially for dead projects whose sites/Twitter vanish (`CARDANO_DATA_LAYER.md` §5). |
| **Expose?** | Durable part as a thin CIP-26 passthrough (do not rebuild — redundant). Curated part as a re-curated Project Metadata API. |
| **Public?** | Durable part: yes (CIP-26 free, on-chain trustless). Curated part: yes if re-curated under open license; the best external sources are locked (CardanoCube) or thin/rate-limited (builtoncardano: logo/name/industries/desc, ~1k req/day, no audit/date/team — registry §4). |
| **Reproducible?** | Durable part **yes**; curated part **no** (human curation + perishable). |

**Moat content: split.** Token Metadata API = "No / weak gap, REPRODUCIBLE, build = redundant" → include only as a thin passthrough. Project Metadata API = "Yes — strong gap, UNIQUE (curated), PERISHABLE" (`CARDANO_DATA_LAYER.md` verdict table).

---

## THE MOAT

Across 61 endpoints, exactly **three things** are genuinely hard or impossible to replace. Everything else (buckets 1–2, ~50 endpoints) is a commodity rebuild — re-derivable from Koios/Blockfrost/Minswap/DexHunter/OpenCNFT/CIP-26, expensive at worst, with no defensible edge. The moat is the intersection of **unique** (not on-chain/registry-derivable) and **perishable** (lost forever once the source dies).

### Moat 1 — Editorial / project & token curation (buckets 4 + 7-curated)
*Descriptions TapTools authored, socials submitted to it, classifications, audit status, launch dates, team — the human overlay on top of chain data.*

- **Preserved?** **Partially.** Project Memory pinned the **20 CardanoCube "graveyard" dead-project profiles** and the **CardanoCube ~74-category taxonomy** as the bootstrap editorial seed, plus a **2,224-URL historical-project-metadata index** (CDX). TapTools' *own* curated `links`/`collection/info` set is captured only insofar as it was mirrored before sunset; the live API surface itself is not archived as a dataset.
- **Exposed?** **No.** No live API serves this yet. The Project Memory archive is provenance/seed, held under a separate trust boundary; the Data Layer would *reference* it, not entangle (`CARDANO_DATA_LAYER.md` relationship section).
- **Public?** **Partially / constrained.** Seed content from CardanoCube is "all rights reserved" — must be re-curated/attributed, not republished. Open-licensable seeds exist (CRFA MIT, Dev Portal MIT). Our own forward curation can be openly licensed.
- **Reproducible?** **No.** Not derivable from chain or registries; for dead projects, unrecoverable once site + Twitter are down. This is the textbook moat: unique + perishable.

### Moat 2 — Historical category & ranking state (buckets 5 + 6)
*What was classified as what, and what ranked where, at a point in time — state the live API never exposed.*

- **Preserved?** **Partially — and this is the strongest concrete asset this project holds.** Project Memory **mirrored TapTools' pre-SPA ranking grids** (server-rendered, Wayback-snapshottable before the site became a JS SPA) plus the **CDX index**. That is bucket-5/6 state frozen before shutdown — precisely the data that "the only record is the Wayback Machine's incidental snapshots, which is why the Memory Layer captured the pre-SPA ranking grids" (`CARDANO_DATA_LAYER.md` §1). It is a *point-in-time snapshot*, not a continuous series.
- **Exposed?** **No.** Held as archive, not served as a dated rankings/category API.
- **Public?** Yes for the observed-fact form under the observability rule (descriptive, time-anchored — MARKET_REALITY §0); curated-taxonomy seed carries the same re-curation constraint as Moat 1.
- **Reproducible?** **No.** No versioned public store ever existed; recomputing past rankings would require a price/volume/mcap series that the live API did not let anyone backfill.

### Moat 3 — Perishable market history not captured now (bucket 3)
*Cross-DEX token OHLCV/price, NFT floor OHLCV, trended holders/listings/volume, market-stats and wallet-value time series — any of it that nobody is persisting as of today.*

- **Preserved?** **Largely no (forward-looking gap).** This is the one moat the archive does **not** secure: the Project Memory capture is editorial/ranking snapshots, not a continuous candle/series feed. On-chain DEX/NFT *trade events* persist, but the **consolidated cross-DEX OHLCV** TapTools computed is not being persisted by us — so the gap between now and any future build is unrecoverable.
- **Exposed?** **No** (nothing being persisted to expose).
- **Public?** Would be, if captured — with third-party-priced legs (USD) tagged non-reproducible (MARKET_REALITY §4.5).
- **Reproducible?** **No after the fact**, by construction (bucket 3). The honest status: this is the actively-decaying item; if a continuous capture isn't stood up, this slice of the moat is being lost daily.

---

### Honest bottom line

- **What's safe (commodity, ~50 endpoints):** prices, OHLCV-going-forward, mcap, supply, holders, NFT floor/volume/sales, wallet valuation — all re-derivable from open sources (registry §1–3; gap analysis §3). No moat, no urgency beyond engineering. Note even TapTools leaned on the **open** `minswap/market-cap` repo for the hardest field (circulating supply), and that survives.
- **What's the real moat (unique + perishable):** **(1) editorial/project curation**, **(2) historical category + ranking state**, **(3) uncaptured market history.**
- **What we already hold:** Moats 1 and 2 are **partially preserved** by the Project Memory event-sourced archive — the pre-SPA ranking grids, the CDX index, the CardanoCube taxonomy + 20 graveyard profiles + 2,224-URL index. That preservation is **provenance/seed, not yet an exposed or public API.**
- **What's still bleeding:** Moat 3 (continuous cross-DEX market history) is **not** secured and decays daily; and even Moats 1–2 are *point-in-time snapshots*, not a maintained, openly-licensed, forward-curated live layer. The open governance/maintenance question (`CARDANO_DATA_LAYER.md` open-questions #1) and licensing/re-curation of the rights-restricted seed remain the gating constraints before any of this becomes a public, reproducible primitive.

*File written: `~/cardano-data-layer/TAPTOOLS_MOAT_ANALYSIS.md`.*
