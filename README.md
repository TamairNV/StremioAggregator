# StremioAggregator

Asks your 4 stream addons for streams, merges duplicates, scores them by popularity and returns
**3 best 4K + 2 best 1080p**, always with at least one Real-Debrid and one TorBox pick.

## Setup
1. Copy `providers.example.json` to `providers.json` and paste in each addon's **manifest URL**
   (the one with your RD/TB key baked in, from that addon's configure page). Set `debrid` to `RD`, `TB` or `P2P`.
   - `"backup": true` means that provider is only used to fill slots the others couldn't (e.g. RD/TB down or nothing found).
   - `"resolutions": ["1080p"]` limits a provider to those resolutions.
2. `npm install && npm start`
3. In Stremio: Add-ons → paste `http://<host>:7000/manifest.json`.

Uninstall (or keep below it) the 4 original addons if you only want to see the top 5.

## How scoring works
- Seeders/peers are parsed from the stream text (`👤 123`, `🌱 123`, `Seeders: 123`, ...).
- Same release (same infohash or filename) on the same debrid from several addons is merged, keeping the highest seeder count.
- score = `10·log2(1+seeders)` + `15` per extra addon listing it + `10` if cached.
- Prefers 5 different releases. If all picks land on one debrid, it swaps the cheapest pick for the best one from the other service.
- Short on 4K? It backfills with 1080p (and vice versa).

## Options (env vars)
| var | default | |
|---|---|---|
| `PORT` | 7000 | |
| `PROVIDERS` | – | JSON array instead of `providers.json` |
| `ONLY_CACHED` | false | drop streams marked uncached |
| `UPSTREAM_TIMEOUT_MS` | 6000 | per-addon timeout |
| `CACHE_MINUTES` | 30 | result cache |

## Deploy
Stremio needs HTTPS for addons outside localhost. Easiest options:
- **Render / Railway / Fly.io**: deploy this folder as a Node app, set `PROVIDERS` as a secret env var (it contains your debrid keys).
- **At home**: run it and expose with a Cloudflare Tunnel or Tailscale Funnel.

Keep the URL private: anyone with it streams on your debrid accounts.

`npm test` runs the picking tests.
