# API build spec — parallel streams (deconfliction contract)

Hard rules so parallel agents never collide:
- **One agent owns exactly one file.** Do NOT edit any file you don't own. Never edit
  `server.js`, `router.js`, `db.js`, `cache.js`, `http.js`, `config.js`, `lib/envelope.js`,
  or another stream's module.
- **Zero new npm deps.** Node 22 built-ins + existing helpers only.
- **Within a module, register literal routes BEFORE parameterized ones** (`/x/search` before `/x/:id`),
  and put `/:id` catch-alls LAST in the routes array.
- **New DB tables: `CREATE TABLE IF NOT EXISTS`**; never drop another stream's table.
- **Every response uses the data-quality envelope** (Stream H): `import { dq } from '../lib/envelope.js'`
  and return `{ status, body: dq(body, { source, authority_class, refresh, confidence, provenance }) }`.
  authority_class ∈ A/B/C/D/E. refresh ∈ realtime|~1m|~5m|hourly|daily|static|on-demand.

The server auto-loads `modules/*.js` (each default-exports `{name, init?, routes}`); a handler is
`async ({req, query, params, ctx}) => ({status, body, headers?})`. ctx = `{db, cache, config, log}`.

## Stream → file → routes

### A — token.js (EXTEND existing; owner: Agent A)
Keep existing `/token/price`, `/token/ohlcv`, `/token/mcap`, `/tokens/top`. ADD:
- `GET /token/search?q=` — search tracked/seed tokens + DexHunter token search by ticker/name.
- `GET /token/list` — list known tokens (seed set + any tracked).
- `GET /token/:id` — **merged detail** for a unit (policyId+hexAssetName): metadata (CIP-26 via sources/cip26), supply (Koios sources/koios), spot price (sources/dexhunter), holder count (Koios). Register `/token/search`, `/token/list` (literal) before `/token/:id` (LAST). Note `/token/holders|supply|metadata` are owned by onchain.js (loads first) — do not duplicate; `/token/:id` aggregates by calling the sources directly.
Sources: sources/koios.js, sources/cip26.js, sources/dexhunter.js. authority: B (metadata/supply, Koios/CIP-26), C (price, DexHunter).

### B — market.js (NEW; owner: Agent B)
- `GET /price/:id` — spot price ADA+USD (sources/dexhunter; cross-check sources/minswap). authority C.
- `GET /ohlcv/:id?interval=&limit=` — candles aggregated from the `ohlcv` table (same on-read bucketing as token.js ohlcvHandler). In `init`, `CREATE TABLE IF NOT EXISTS ohlcv (...)` matching token.js schema (unit,ts,interval,o,h,l,c,v,source PRIMARY KEY(unit,interval,ts)).
- `GET /markets` — market overview: counts of tracked units + latest tick per tracked unit. authority C.
- `GET /price/history/:id?limit=` — raw tick history for a unit from the ohlcv table.
The history clock (poller cron) is already running and must keep running — do NOT change the poller; just read what it writes. authority C, refresh ~5m.

### C+D — project.js (EXTEND existing; owner: Agent CD)
Keep `/projects`, `/project/:id`, `/categories`, `/history/:project`. ADD:
- `GET /project/search?q=` — substring search over project id/name (register BEFORE `/project/:id`).
- `GET /category/:slug` — one category + its (active) project assignments, from the projection tables.
Read-only (Project Memory is event-sourced; no writes). authority D (cardanocube) / C (taptools) per claim; refresh static. Use dq().

### E — governance.js (NEW; owner: Agent E) — Governance + Treasury Memory integration
Reads `config.memory.observatoryDir` (the observatory's CC0 snapshot exports). Files:
`top30.json` (`.entries` = DReps), `actions.json` (array, 120; keys action_id/action_type/title/outcome/drep_*_count),
`treasury_snapshot.json` (`.epochs`), `live/recent_votes.json` (array; vote_block_time/drep_id/vote/action_id).
- `GET /dreps` — top DReps from top30.json `.entries`. `GET /dreps/:id` — one (match drep_id).
- `GET /actions?type=&outcome=` — governance actions. `GET /actions/:id` — one by action_id.
- `GET /votes` — recent votes from live/recent_votes.json.
- `GET /treasury` — treasury snapshot (latest epoch + series from treasury_snapshot.json + treasury_withdrawals.json).
authority A (on-chain-derived governance), refresh daily (live votes ~10m). provenance: "Governance/Treasury Memory — observatory CC0 export". If a file is missing, return 503 dqError, don't crash.

### F — catalyst.js (NEW; owner: Agent F) — Catalyst Memory integration
Reads `config.memory.catalystArchive` (the catalyst preservation archive). Structure: `INDEX.json`
(subfolders w/ source_authority_class, artifact_count), subfolders `projectcatalyst-io/`, `catalyst-explorer/`,
`catalyst-core/`, `ideascale/`, `milestones/`, `on-chain/` each with `INDEX.json` + `CAPTURE_LOG/*.json` + `.custody.json` artifacts.
- `GET /archive` — the archive INDEX.json (subfolders, authority classes, counts, last capture).
- `GET /funds` — funds derivable from captured artifacts (parse capture logs / custody source_urls for fund numbers, e.g. /funds/9); be honest that coverage = what's captured (currently sparse).
- `GET /fund/:id` — captures relating to one fund id.
- `GET /proposals` — proposals derivable from captures (sparse; list what exists).
authority B (projectcatalyst.io captures), refresh static (archive). provenance: "Catalyst Memory archive (chain-of-custody)". Honest about sparseness; never fabricate proposals.

### J — DX (NEW files; owner: Agent J)
Create `openapi.json` (OpenAPI 3.1 covering ALL routes in this spec incl. existing nft/onchain), `API.md`
(human README: every endpoint, example curl, example response incl. the `_quality` block, auth/keys, rate-limit
notes per upstream), and `examples/` curl + a tiny JS fetch SDK example. Do NOT edit modules; read this spec + the
existing module files to enumerate routes. Note read-only + the data-quality envelope.

## Memory integration (Stream I) — realized by C/D (Project Memory), E (Governance+Treasury Memory), F (Catalyst Memory)
The Data Layer thereby surfaces all four memory layers behind one API, each labeled with authority class +
provenance via the envelope. Main thread documents the wiring after merge.
