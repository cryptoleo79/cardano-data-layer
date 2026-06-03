# Cardano Data Layer

A neutral Cardano **data-infrastructure** layer prompted by the TapTools shutdown (company wind-down announced 2026-06-02): the research/design that establishes the gap, plus a working MVP service that re-floats the orphaned data capabilities — **not** a TapTools clone.

- **Research & design:** the three documents below.
- **Working MVP:** [`service/`](./service/) — a zero-dependency Node 22 service exposing 15 routes, live-verified against open Cardano sources (DexHunter, Koios, CIP-26) with a curated project/category "moat" seeded from the preservation archive. See [`service/README.md`](./service/README.md).

This work is the **Data Layer** track. It is separate from the **Memory Layer** preservation work (FLOW-6 Catalyst archive, Project Memory archive), which is archival. The Data Layer would *consume* the Memory Layer as a seed source under chain-of-custody, but is a distinct trust boundary and a distinct product.

## Documents

- **[TAPTOOLS_API_GAP_ANALYSIS.md](./TAPTOOLS_API_GAP_ANALYSIS.md)** — every TapTools API capability classified by developer demand (HIGH/MEDIUM/LOW), with reproducibility, difficulty, source availability, maintenance burden, the minimum viable API, and a source-to-capability matrix.
- **[CARDANO_DATA_LAYER.md](./CARDANO_DATA_LAYER.md)** — the data-infrastructure thesis. Answers: what disappears, what is unique vs reproducible vs impossible-to-reconstruct, and whether Token Metadata + Project Metadata + Category APIs are a real gap. Verdict on each of the three.
- **[MVP_REPLACEMENT_BLUEPRINT.md](./MVP_REPLACEMENT_BLUEPRINT.md)** — the concrete replacement design: API surface, per-route data sources, build order, cost/sustainability, and the decisions a build would require.

## Headline findings

- The gap is **real, acute, and time-boxed** — no replacement announced; existing infra (Blockfrost/Koios/Maestro) covers raw chain data but not the orphaned price/market-cap/NFT-floor/liquidity layer.
- **Market data is a commodity rebuild** (mostly reproducible from Minswap/DexHunter + Koios/Blockfrost + OpenCNFT). **Project & category metadata is the only genuine moat** — unique, perishable, served by nothing open.
- Recommendation: a neutral data layer that leads with the **category/project moat** (seeded from the preservation archive) and wraps commodity market data as a thin convenience layer — **not** a TapTools clone. Feasibility is not the constraint; a sustainability/curation model is.

## Caveats to confirm before acting

- Exact TapTools OpenAPI endpoint list (some paths are reconstructed from documented groups, not pulled from the live spec).
- The precise "Adam's post" wording (the shutdown itself is the demand signal regardless).
