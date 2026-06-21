# Project Memory — Enrichment Baseline

**As of:** 2026-06-22 (Completion Sprint closed; opportunistic 2-failure retry done). **Enrichment paused.**

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
| **Enriched (≥1 sourced link)** | **787 / 847 (92.9%)** |
| **Unenriched** | **60** |

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

## The 60 remaining, classified

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

### B. Source unavailable — 1
The page is reachable (HTTP 200) but the link source **is not reliably retrievable**, so
no reproducible custody can be captured. Not enriched — using a one-off capture the
source won't re-serve would be unreproducible "best effort," which the rules forbid.

> **daedalus-turbo** — its cardanocube page is a SPA shell: the Wayback `id_` snapshot
> contains no rendered links, and a plain fetch returns no link attributes. A single
> `curl -L` capture once showed a `data-project-link-type="website"`, but it is not
> reproducible, so we cannot anchor a SHA-256 to bytes the source reliably serves.
> Revisit only if cardanocube renders its links server-side consistently.

### C. Transient fetch failure — 0
**chainsofwar** (the other sprint-run failure) was retried opportunistically on
2026-06-22: its page served the links cleanly and it is now enriched (website +
whitepaper, Wayback `id_` + SHA-256 custody). Bucket now empty.

---

## Summary

| Class | Count | Fixable? |
|-------|------:|----------|
| A · No source exists | 59 | No — would require inventing/inferring/ticker-guessing |
| B · Source unavailable | 1 | Only if cardanocube renders the link reproducibly |
| C · Transient fetch failure | 0 | — (chainsofwar retried & enriched 2026-06-22) |

**Realistic ceiling from current sources: 787 / 847** (today). The remaining 60 are not a
backlog: 59 have no honestly-sourceable link, and 1 (daedalus-turbo) has no reproducible
custody. Closing any of them would mean breaking the rules — so they stay open.

## Next

Enrichment is **paused**. The next sprint is gated on **evidence** (see the adoption
loop): does the enrichment actually change Projects-page traffic, project-page depth, or
API usage? Only a measured signal — not a round number — justifies resuming.
