#!/bin/sh
# Run on the server: pull main, rebuild and recreate the container, roll back if it doesn't answer.
# The code is baked into the image, so a plain `docker restart` would keep running the old code.
set -eu
cd "$(dirname "$0")"
NAME=stremio-aggregator

git pull -q --ff-only origin main
SHA=$(git rev-parse --short HEAD)

# Same run options every time, kept here so they can't drift.
run() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped -p 7000:7000 \
    -e UPSTREAM_TIMEOUT_MS=4000 \
    -v "$PWD/providers.json:/app/providers.json:ro" \
    "$1" >/dev/null
}
healthy() {
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    curl -sf -m 3 http://localhost:7000/manifest.json >/dev/null && return 0
    sleep 1
  done
  return 1
}

docker image inspect "$NAME:latest" >/dev/null 2>&1 && docker tag "$NAME:latest" "$NAME:previous"
docker build -q --label revision="$SHA" -t "$NAME:latest" . >/dev/null
run "$NAME:latest"

if healthy; then
  echo "Live: $SHA ($(git log -1 --format=%s))"
else
  echo "New container didn't answer, rolling back" >&2
  docker logs --tail 20 "$NAME" >&2 || true
  docker image inspect "$NAME:previous" >/dev/null 2>&1 && run "$NAME:previous" && docker tag "$NAME:previous" "$NAME:latest"
  exit 1
fi
