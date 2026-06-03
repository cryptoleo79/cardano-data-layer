# Minimum Viable TapTools Replacement — Blueprint

**Status:** design synthesis, v1. **No code. No commitment to build.**
**Date:** 2026-06-03.
**Purpose:** Take all of the gap-analysis and data-layer research and turn it into a single concrete picture of *what a replacement would actually be* — surface, data sources, build order, cost, and the decisions a build would require. This is the "take all info to replace TapTools" deliverable.
**Read first:** `TAPTOOLS_API_GAP_ANALYSIS.md`, `CARDANO_DATA_LAYER.md`.

---

## 1. Design principles (what keeps this from becoming a clone)

1. **Re-float the orphaned consumers fast, moat slowly.** Ship thin proxies over existing open APIs for the commodity data so dependents (wallets, bots, dashboards) keep working within days; invest real effort only in the unique/perishable editorial layer.
2. **Own only what nothing else serves.** The market layer is a convenience wrapper. The project/category layer is the actual product.
3. **Open license + versioned history.** The differentiator vs TapTools (closed) and builtoncardano (thin). Categories and project records carry an auditable change history.
4. **Standards-aligned.** CIP-26 (token metadata), CIP-72/CRFA (project identity), CIP-52 (audit semantics). Don't invent a competing silo.
5. **Stateless where possible, stateful only for what's perishable.** Price/holders/metadata can be proxied/cached. OHLCV history and category-state history must be *persisted continuously* — if not captured now, they can't be backfilled.

---

## 2. API surface (MVP)

Eight route groups. Items 1–4 are the engineering core; 5–7 are thin proxies; 8 is the moat.

| # | Route | Returns | Source strategy | Type |
|---|---|---|---|---|
| 1 | `GET /token/price?unit=` | spot price ADA + USD | Minswap aggregator estimate / DexHunter quote, cached ~30–60s | core |
| 2 | `GET /token/ohlcv?unit=&interval=` | candles | persisted from a price-polling job (Minswap candles where available) | core (stateful) |
| 3 | `GET /token/mcap?unit=` | market cap, FDV, supply | price (#1) × on-chain supply (Koios/Blockfrost) | core |
| 4 | `GET /tokens/top?by=mcap\|volume\|liquidity` | rankings | derived from #1–#3 + DEX volume | core |
| 5 | `GET /token/holders?unit=` | holder count + top holders | Koios `asset_addresses` / Blockfrost `/assets/{asset}/addresses` | proxy |
| 6 | `GET /token/metadata?unit=` | ticker/name/decimals/logo/links | CIP-26 `tokens.cardano.org/metadata` batch + CIP-25/68 on-chain merge | proxy |
| 7 | `GET /nft/collection/stats?policy=` | floor, volume, sales, distribution | OpenCNFT proxy | proxy |
| 8 | `GET /project/{id}`, `GET /categories`, `GET /category/{slug}` | project profiles + taxonomy + assignments | curated store, seeded from Memory Layer archive | **moat** |

Explicitly **out of MVP scope** (client-computable or low-demand): technical indicators, NFT rarity/traits, DeFi debt/loans, per-asset NFT detail, fiat-quote config, full wallet PnL. Wallet/portfolio (`/wallet/*`) is **Phase 2** — it depends on the price layer existing first.

---

## 3. Data source plan (per route group)

**Token price / OHLCV / mcap / rankings (core).**
- Primary price: Minswap aggregator estimate (first-party, SDK-backed, largest TVL) with DexHunter as cross-DEX cross-check. Both are quote-shaped, so a normalization step produces a canonical spot price.
- Coverage caveat: skews to *liquid* tokens. Long-tail tokens with thin liquidity get low-confidence prices — flag confidence in the response.
- OHLCV: poll price on a fixed cadence and persist; use Minswap per-pool candles where exposed to backfill. **This is the one dataset that must start now** — history is unrecoverable.
- Supply for mcap: Koios/Blockfrost asset endpoints.
- Maintenance: medium-high; the price pipeline and time-series store are the real ops burden.

**Token holders / supply (proxy).** Koios (free 5k/day public, 50k keyed) or Blockfrost (free key ~10 req/s). Cache aggressively. Holder *count* for very large tokens requires paging — cache the result.

**Token metadata (proxy).** CIP-26 batch endpoint (`POST /metadata/query`) — fully free. Merge on-chain CIP-25/68 for tokens missing a registry entry. Coverage gap: opt-in registry means long-tail/abandoned tokens may be absent; fall back to on-chain mint metadata.

**NFT (proxy).** OpenCNFT (open, `X-Api-Key`, attribution required) covers floor/volume/sales/distribution by policy ID in single calls — the cheapest win. **Risk:** OpenCNFT itself could follow jpg.store into sunset; design the NFT module behind an interface so the source is swappable (fallback = reconstruct sales from marketplace contract txs via db-sync — expensive).

**Project / category (moat).** No open source — this is curated. Seed from:
- Memory Layer archive: cardanocube taxonomy (~74 categories) + 20 graveyard project profiles (pinned), TapTools pre-SPA ranking grids + the 2,224-URL index.
- Live re-curation (not wholesale republication — cardanocube is "All rights reserved"): re-derive a neutral taxonomy, attribute sources, store under an open license.
- Standards: align project IDs with CIP-72/CRFA script-hash → dApp mappings where they exist.

**Sources to avoid relying on:** jpg.store API (sunset); GeniusYield/SundaeSwap/WingRiders (no documented public analytics APIs — reach via aggregators/on-chain only); DefiLlama for per-token data (DeFi-only, protocol-level — fine for category cross-reference, not token prices).

---

## 4. Build order

| Phase | Deliverable | Effort | Rationale |
|---|---|---|---|
| **0** | Stand up the OHLCV persistence job | small but **urgent** | History is unrecoverable; start the clock before TapTools is gone. |
| **1** | Proxy layer: holders, metadata, NFT stats | small | Cheap wins over open APIs; immediately useful. |
| **2** | Core: price → mcap → rankings | medium-large | The orphaned HIGH-demand core; the real engineering. |
| **3** | Moat: project + category API, seeded from archive | medium (engineering) + ongoing (curation) | The differentiator; the only durable advantage. |
| **4** | Wallet/portfolio | medium | Depends on Phase 2. |

Phases 0–1 could re-float a meaningful chunk of orphaned consumers quickly; Phase 2 restores the core; Phase 3 is what makes it infrastructure rather than a stopgap.

---

## 5. Cost & sustainability reality check

- **Build:** Phases 0–2 are a small-team effort over weeks; Phase 3 is open-ended because of curation.
- **Run:** mostly free/cheap data sources (Koios/Blockfrost free tiers, OpenCNFT open, CIP-26 free, Minswap/DexHunter keyed-but-free) + a modest time-series DB + a poller. The dominant cost is **human curation** of the editorial layer, not infrastructure.
- **The cautionary fact:** TapTools shut down *despite* being "fast, cost-effective" and near-monopoly. A replacement needs a sustainability model up front — Catalyst funding, a foundation/public-good grant, or a thin paid tier over a free open core — or it repeats the failure. This is a *governance* question, not a technical one.

---

## 6. Decisions required before any build

1. **Build vs blueprint.** This document is a plan, not code. Proceeding to implementation is a separate, explicit decision. (Note the tension with the earlier "do not build a TapTools replacement / not a clone" guidance — the disciplined reading is: build the *neutral data-infrastructure layer*, not the trader product.)
2. **Scope lock.** Commit to the thin-proxy / deep-moat split, or it drifts into a full clone.
3. **Curation & governance model** for the editorial layer (the make-or-break).
4. **Licensing** of the seed data (re-curate + attribute; don't republish "All rights reserved" content wholesale).
5. **Relationship to the Memory Layer** — reference-as-seed under chain-of-custody, separate trust boundary, separate repo.
6. **Verification of two research caveats** before relying on them: the exact TapTools OpenAPI endpoint list, and the "Adam's post" wording.

---

## 7. One-paragraph recommendation

There is a genuine, time-boxed gap. The market-data half is a commodity rebuild (thin proxies + a price/OHLCV pipeline that must start now); the project/category half is unique, perishable, and served by nothing open — that is the only part worth treating as new infrastructure. The disciplined move is **not** a TapTools clone but a neutral Cardano Data Layer that leads with the category/project moat (seeded from the preservation archive) and wraps the commodity market data as a convenience layer. Whether to actually build it hinges less on feasibility — it is feasible — and more on a sustainability/curation model that TapTools itself lacked.
