# Deployment — Cardano Data Layer

## D-1 — Architecture proposal

**Recommended domain: `api.asy.life`.** Options considered:

| Option | For | Against | Verdict |
|---|---|---|---|
| **`api.asy.life`** | Short, memorable, ecosystem-level (not tied to one site); reads as "the API for the whole asy.life ecosystem" | New apex-level subdomain | **Recommended** |
| `data.asy.life` | Descriptive | "data" reads like downloads/datasets, not a live API; `api` is the developer convention | runner-up |
| `api.observatory.asy.life` | Scoped under the observatory | Wrongly implies the API is only governance/observatory data; it spans token/NFT/project/Catalyst too; longer to type | no |

The Data Layer surfaces *all four memory layers + market data*, so it should sit at the ecosystem level, not under one site. **`api.asy.life`.**

**Topology:** public `api.asy.life` → nginx (TLS, reverse proxy) → Node service on `127.0.0.1:8787` (user-systemd, `Restart=always`, linger enabled so it survives reboot). Zero runtime deps; ~18 MB RSS; read-only (GET only, no write paths, no accounts). CORS `*` is emitted by the app so browsers can fetch it.

## D-2/D-3 — what is already done (no sudo needed)

- Node service runs under **user-systemd**: `cardano-data-layer.service` (`~/.config/systemd/user/`), `enable --now`, **linger enabled** (reboot-persistent). Health: `http://127.0.0.1:8787/health`.
- First-class endpoints live: **`/health`**, **`/openapi.json`** (OpenAPI 3.1, 34 paths), **`/docs`** (self-contained documentation page), `/routes`, and `/`→`/docs`.
- OHLCV history poller continues via the existing `*/5 * * * *` user cron (the "history clock").

## Go-live — the only steps that need you

1. **DNS (registrar):** add `api.asy.life` → `194.36.144.105` (A) and the IPv6 AAAA if used. Wait for it to resolve (`getent hosts api.asy.life`).
2. **Proxy + TLS (server, sudo):**
   ```sh
   bash ~/cardano-data-layer/service/deploy/deploy.sh
   ```
   (installs the nginx vhost, reloads nginx, runs certbot for the cert + redirect). sudo will prompt in your shell.

Then: `curl https://api.asy.life/health` — live.

## D-4 — verification (local baseline; re-run against the public URL after go-live)

- **Latency:** `/health` ~6–7 ms locally; data routes dominated by upstream calls (cached).
- **Memory:** ~18 MB RSS steady (single Node process, in-memory TTL cache).
- **Uptime:** `Restart=always` + linger; `systemctl --user status cardano-data-layer`.
- **Refresh cadence:** declared per-endpoint in each response's `_quality.refresh` (realtime/~5m/hourly/daily/static/on-demand); OHLCV ticks every 5 min via cron.
- Post-go-live checks: `curl -w '%{time_total}\n' https://api.asy.life/health`; `systemctl --user status`; watch `journalctl --user -u cardano-data-layer`.

## Operations

- **Logs:** `journalctl --user -u cardano-data-layer -f`
- **Restart:** `systemctl --user restart cardano-data-layer`
- **Deploy new code:** `git -C ~/cardano-data-layer pull && systemctl --user restart cardano-data-layer`
- **Rollback:** `git checkout <prev> && systemctl --user restart cardano-data-layer`; to remove the site: `sudo rm /etc/nginx/sites-enabled/api.asy.life && sudo systemctl reload nginx`.

## Notes / limits

- Read-only by design; if abuse appears, add an nginx `limit_req` zone (not enabled in v1).
- `/token/holders` needs `BLOCKFROST_PROJECT_ID` and `/nft/*` needs network to OpenCNFT to return live data; both degrade to a clean `503` with a `_quality` block otherwise. Set keys in the systemd unit's `Environment=` and restart.
