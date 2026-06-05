# Cardano API Gap Analysis

**Status:** research synthesis, v1. **Date:** 2026-06-05.
**Built from:** `CARDANO_API_REGISTRY.md` (the full inventory). Complements the earlier, TapTools-specific `TAPTOOLS_API_GAP_ANALYSIS.md` and the thesis in `CARDANO_DATA_LAYER.md`. This document takes the **whole** Cardano API surface and asks: what's at risk, what's unique, what's reproducible, what's in demand, and what a neutral Data Layer should actually provide.

---

## 1. What APIs disappear if TapTools dies?

TapTools is sunsetting (~mid-to-late June 2026). What goes dark, and whether it's recoverable:

| Capability lost | Recoverable from open sources? | How |
|---|---|---|
| Token spot price | **Yes (easy)** | DexHunter `/swap/averagePrice`, Minswap metrics, Charli3 quotes |
| Token OHLCV / candles | **Yes (easy-medium)** | Charli3 (TradingView history), Minswap `/price/candlestick`, DexHunter `/charts` |
| DEX liquidity & 24h volume | **Yes (easy)** | DexHunter `/stats/*` + Minswap `/pools/*` + DefiLlama `/overview/dexs/cardano` |
| Token rankings (top by mcap/vol) | **Partial** | derivable once you compute price+mcap+volume yourself |
| **Market cap / circulating supply** | **Hard** | Minswap exposes some; otherwise assemble price (DEX) × on-chain supply (Koios/Blockfrost) per token |
| **Token holder count / distribution** | **Hard** | reconstruct from Koios `/asset_addresses` / Blockfrost `/assets/{a}/addresses` (paging, compute) |
| **Wallet portfolio valuation** | **Hard** | build in-house: chain holdings × price history |
| **Cross-protocol loan/debt aggregation** | **Hard** | bespoke per-protocol (Lenfi/Liqwid) indexing |
| **Ecosystem-wide market stats** | **Hard** | bespoke aggregation across all the above |
| NFT floor/volume/sales | **Yes (medium)** | OpenCNFT (now the single source of truth) |

**Net:** the *prices/charts/DEX-volume* layer is a commodity that survives TapTools via 3–4 open sources. The genuinely orphaned residue is **mcap+circulating supply, holder distribution, portfolio valuation, loan aggregation, and ecosystem stats** — all UNIQUE to TapTools and requiring real indexing to rebuild. Plus a soft loss: TapTools was the one-call convenience layer; its death fragments the market-data surface into a multi-source assembly.

**Also already gone (not TapTools):** jpg.store API (sunset 2026-05-23) — NFT marketplace data now routes through OpenCNFT or self-indexing.

---

## 2. What APIs are unique?

UNIQUE = served by one source (or none openly); loss is not trivially recoverable.

- **TapTools-only (until shutdown):** unified mcap+circulating supply, holder distribution, portfolio valuation, cross-protocol loans, ecosystem market stats. *(becoming MISSING)*
- **OpenCNFT-only (open NFT data):** aggregated NFT floor/volume/sales/rankings. Single-source-of-truth risk now that jpg.store is gone.
- **CardanoCube-only (curated breadth):** the largest curated project directory with categories + socials — but **website-only and all-rights-reserved** (no API, republication restricted). *(effectively MISSING as an API)*
- **GovTool Proposal Pillar-only:** off-chain governance proposal drafts + discussion — not on chain, no alternative source. Data-use policy still "TBD".
- **IdeaScale-only (historical Catalyst):** early-fund proposal text + comments + assessments — vendor-controlled, admin-gated, sunsetting. *(at-risk → soon MISSING)*
- **Jörmungandr datasets:** raw historical Catalyst votes on deprecated infra — survives only via archives.
- **Charli3-only:** on-chain oracle price feeds (push/pull) — distinct from read APIs.

The pattern: **editorial/curated and historical data is where uniqueness concentrates** (CardanoCube, IdeaScale, GovTool drafts). On-chain-derived data is rarely unique because anyone can re-derive it.

---

## 3. What APIs are reproducible?

REPRODUCIBLE = derivable from open primitives; no moat.

- **All on-chain data** — token supply/metadata/holders, addresses, full Conway governance (DReps/actions/votes/committee/treasury), pools, blocks, tx. Koios + Blockfrost + self-host db-sync. Authority A/B, durable, redundant. *Building another of these is redundant.*
- **Token metadata** — CIP-26 registry has an open consolidated API (`tokens.cardano.org/metadata`) + Koios/Blockfrost passthrough; CIP-25/68 on-chain.
- **DEX price/OHLCV/volume** — reproducible by aggregating Minswap + DexHunter + Charli3 + DefiLlama (mechanical; the only cost is continuous OHLCV persistence — history is unrecoverable if not captured now).
- **NFT floor/volume/sales** — reproducible from marketplace contract txs via db-sync (hard) or proxied via OpenCNFT (easy).
- **Governance metadata** — reproducible from on-chain anchors (subject to link-rot of the off-chain target).

---

## 4. What APIs are high demand?

Ranked from the TapTools shutdown coverage + documented integrator dependence (DexHunter, Flux Point, WAVE, trading bots, the Catalyst "API Hackathon", MCP servers) and the observatory/ecosystem context:

**HIGH**
1. Token price + OHLCV (the most-cited loss; powers every chart/bot/dashboard).
2. Token market cap / supply (every token list).
3. DEX liquidity & volume (DeFi screeners, aggregators).
4. Token metadata (ticker/logo/decimals/links — every wallet).
5. NFT floor + volume (the canonical NFT integration).
6. Token holders / distribution (trust/whale signals).

**MEDIUM**
7. Governance: DReps / actions / votes (growing fast post-Conway; the observatory's own domain).
8. Project metadata + categories (discovery; nothing open serves it well).
9. Wallet/portfolio valuation.
10. Catalyst funds/proposals/results (builder + researcher demand).

**LOW**
11. TA indicators (client-computable), NFT rarity, cross-protocol loans, per-asset NFT detail.

---

## 5. What APIs should we provide?

Decision filter: **provide where demand is HIGH and the data is UNIQUE/PERISHABLE or where a neutral consolidation has real value; thin-proxy or skip where it's already solved and reproaroducible.**

### Provide (build / own)
- **Project + Category API** — *the clearest gap.* No open, comprehensive source (CardanoCube locked, builtoncardano thin, DefiLlama DeFi-only). UNIQUE + PERISHABLE. **Already built** (event-sourced Project Memory, seeded from the preservation archive). This is the moat.
- **Consolidated token market layer** — a single `/token/:id` + `/price` + `/ohlcv` that assembles price (DexHunter/Minswap) × on-chain supply (Koios) and **persists OHLCV history now** (the unrecoverable part). Not a TapTools clone — a neutral convenience layer over open sources, with the data-quality envelope making provenance explicit. **Building (Streams A/B).**
- **Governance + Treasury surface** — re-expose the observatory's CC0 governance/treasury exports through the same API + envelope (demand is rising, and it unifies the memory layers). **Building (Stream E).**
- **Catalyst archive surface** — expose the preservation archive (funds/proposals/custody) read-only; and **prioritise archiving the at-risk unique sources (IdeaScale, Jörmungandr, GovTool drafts) before they vanish.** **Building (Stream F) + a preservation action item.**

### Thin-proxy (wrap, don't own)
- Token metadata (CIP-26), token holders/supply (Koios/Blockfrost), NFT floor/volume (OpenCNFT) — cheap convenience wrappers with caching + the envelope; the upstream remains canonical.

### Do NOT build
- Another on-chain indexer (Koios/Blockfrost/db-sync already solve it).
- A TapTools-style trader product (charts/portfolio/exchange UX) — that's trading infrastructure, not data infrastructure, and it's the commodity layer with no moat. (The hard residue — portfolio valuation, loan aggregation, ecosystem stats — is explicitly out of scope unless a clear neutral-infrastructure case emerges.)

### The strategic shape
Lead with the **unique/perishable** layers (project/category + the memory layers + at-risk Catalyst archival); wrap the **commodity** market layer thinly; never duplicate solved on-chain infra. Every endpoint declares **source, authority class, refresh, confidence, provenance** (the data-quality envelope) so the layer's value is *trustable consolidation*, not yet-another-silo.

---

## Time-sensitive preservation actions (do before they vanish)
1. **TapTools** — archive `taptools.io/terms`, the API Terms, and the OpenAPI spec **before the site goes offline** (~mid-June 2026). The redistribution clause is unverified and load-bearing.
2. **IdeaScale** — capture historical Catalyst proposal text/comments while admin-token access still resolves (vendor sunsetting).
3. **Governance metadata anchors (CIP-119/100)** — snapshot anchor targets to defeat link-rot.
4. **OpenCNFT** is now the single open NFT source — design any NFT dependency behind a swappable interface (it could follow jpg.store).
