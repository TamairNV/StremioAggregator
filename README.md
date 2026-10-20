# StremioAggregator

Asks your 4 stream addons for streams, merges duplicates, scores them by popularity and returns
**4K Best** (highest-bitrate cached 4K) + **2 popular 4K** + **2 popular 1080p** + **1080p Lite** (smallest cached 1080p with a few seeders, for bad connections). The popular picks always include at least one Real-Debrid and one TorBox stream.

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
| `LITE_MIN_SEEDERS` | 5 | minimum seeders for the Lite pick |
| `ALLOW_DISC_DV` | off | set to `1` to stop dropping Blu-ray/Remux Dolby Vision (Profile 7, glitches on Apple TV) |
| `BEST_MIN_SEEDERS` | 3 | minimum seeders for the 4K Best pick |
| `UPSTREAM_TIMEOUT_MS` | 6000 | per-addon timeout |
| `CACHE_MINUTES` | 30 | result cache |

## Deploy
Stremio needs HTTPS for addons outside localhost. Easiest options:
- **Render / Railway / Fly.io**: deploy this folder as a Node app, set `PROVIDERS` as a secret env var (it contains your debrid keys).
- **At home**: run it and expose with a Cloudflare Tunnel or Tailscale Funnel.

Keep the URL private: anyone with it streams on your debrid accounts.

### Docker (how the home server runs it)
```bash
docker build -t stremio-aggregator .
docker run -d --name stremio-aggregator --restart unless-stopped -p 7000:7000 \
  -e UPSTREAM_TIMEOUT_MS=4000 \
  -v "$PWD/providers.json:/app/providers.json:ro" \
  -v "$PWD/src:/app/src:ro" \
  stremio-aggregator
```
`providers.json` stays outside the image (it holds your keys). After editing it: `docker restart stremio-aggregator`.
To update the code, merge to main, then from your own machine:
```bash
./deploy.sh          # server pulls main, rebuilds, recreates the container
./deploy.sh status   # which commit is live
```
On the server itself that's just `./update.sh`. `src/` is mounted read-only into the container, so a code change is a
pull plus `docker restart`; the image is only rebuilt when `package.json` or the `Dockerfile` changed (or with
`./update.sh --rebuild`). The server pulls over SSH with a read-only deploy key (`~/.ssh/stremio_deploy`, host alias
`github-stremio` in `~/.ssh/config`).

HTTPS, reachable only from your own Tailscale devices:
```bash
sudo tailscale serve --bg --https=443 http://localhost:7000
```
Then add `https://<machine>.<tailnet>.ts.net/manifest.json` in Stremio.

`npm test` runs the picking tests.
