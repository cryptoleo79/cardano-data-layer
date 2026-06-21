# Project Memory — Enrichment Baseline

**As of:** 2026-06-21 (Completion Sprint closed). **Enrichment paused.**

This records the post-sprint baseline and the exact projects that remain unenriched,
classified by *why*. It is a factual record, not a to-do list — the next enrichment
sprint must be **evidence-driven**, not a chase for round numbers.

**Rules that produced this state (and govern any future sprint):** only sourced, only
provenance-backed. **No invented links. No inferred links. No ticker guessing.**

---

## Baseline

| Metric | Value |
|--------|-------|
| Projects | 847 |
| **Enriched (≥1 sourced link)** | **786 / 847 (92.8%)** |
| **Unenriched** | **61** |

Per-field coverage (distinct projects, active claims):

| Field | Projects |
|-------|---------:|
| website | 742 |
| whitepaper | 172 |
| github | 168 |
| documentation | 70 |

Sources: Built on Cardano directory (Class B, typed `linkArr`), cardanocube project
pages (Class D, `data-project-link-type` attributes), each claim carrying provenance
(Wayback `id_` snapshot + SHA-256, or live capture + SHA-256). Event-log chain: verified.

---

## The 61 remaining, classified

### A. No source exists — 59
No source provides an official link for these. Not fixable without violating the
no-invent / no-infer / no-ticker-guess rules.

**A1 · TapTools token-ranking records (25)** — `kind: token`, id `tt:<TICKER>`. The only
source is a preserved TapTools ranking grid, which carries **ticker + rank only**, no
link field. Enriching them would require mapping a ticker to a project/asset — i.e.
**ticker guessing**, which is forbidden.

> AADA, ADAX, AGIX, C3, CARDS, COPI, DANA, EMP, GERO, HOSKY, LQ, MELD, MILK, MIN, MINt,
> NMKR, NTX, PAVIA, SOCIETY, SUNDAE, VYFI, WMT, XRAY, YUMMI, cNETA

**A2 · Built on Cardano entries with no listed link (34)** — `id boc:<slug>`. These are
present in the Built on Cardano directory, but the directory **publishes no website /
github / whitepaper / docs link** for them (verified against the live `__NEXT_DATA__`
payload). The source exists; it simply carries no link. Mostly memecoins, bots, and
NFT/community pages with no standalone web presence.

> abcde, ada-fractals, ada-street-bets, adam, big-pey, blake-cnft, boop-pop, brown-nft,
> cardano-catalyst-tv, cardano-ecosystem-news, cardano-phishing-bot, cnft-predator,
> cosmic-soul, dessert-cat-nft, discord-management-solutions, e-tuk-tuk, gamez-on-chain,
> graffiti-consortium, paid-xpo, patryk-karter, plooty, repo-ledge, rin-2-s-ai, sapien,
> security-bot, stateof-cardano, tempo, the-bull-boon, the-dictator,
> the-seal-society-merch, the-village-of-jugglers, wallet-bud, wallet-wednesday,
> wonder-whale

### B. Source unavailable — 0
No project currently falls here. Both link sources (Built on Cardano, cardanocube) are
reachable. This bucket is kept so a future outage can be recorded honestly rather than
misfiled as "no source."

### C. Transient fetch failure — 2 (retryable)
cardanocube projects that failed/returned no links **during the sprint run** but whose
pages are reachable now (HTTP 200) and **do carry an official `website` link type**.
A retry in the next sprint would enrich both (→ 788/847). Not retried now: enrichment is
paused.

> chainsofwar, daedalus-turbo

---

## Summary

| Class | Count | Fixable? |
|-------|------:|----------|
| A · No source exists | 59 | No — would require inventing/inferring/ticker-guessing |
| B · Source unavailable | 0 | — |
| C · Transient fetch failure | 2 | Yes — retry in a future, evidence-driven sprint |

**Realistic ceiling from current sources: 788 / 847** (786 today + the 2 transient).
The remaining 59 are not a backlog; they are projects for which no link can be honestly
sourced. Closing them would mean breaking the rules — so they stay open.

## Next

Enrichment is **paused**. The next sprint is gated on **evidence** (see the adoption
loop): does the enrichment actually change Projects-page traffic, project-page depth, or
API usage? Only a measured signal — not a round number — justifies resuming.
