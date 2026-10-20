#!/bin/sh
# Run on the server: pull main and restart the addon. src/ is mounted into the container, so a code
# change only needs a restart; the image is rebuilt only when package.json or the Dockerfile changed.
set -eu
cd "$(dirname "$0")"
NAME=stremio-aggregator

OLD=$(git rev-parse HEAD)
git pull -q --ff-only origin main
SHA=$(git rev-parse --short HEAD)

# Same run options every time, kept here so they can't drift.
run() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped -p 7000:7000 \
    -e UPSTREAM_TIMEOUT_MS=4000 \
    -v "$PWD/providers.json:/app/providers.json:ro" \
    -v "$PWD/src:/app/src:ro" \
    "$1" >/dev/null
}
healthy() {
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    curl -sf -m 3 http://localhost:7000/manifest.json >/dev/null && return 0
    sleep 1
  done
  return 1
}

if [ -n "$(git diff --name-only "$OLD" HEAD -- package.json package-lock.json Dockerfile)" ] || [ "${1:-}" = --rebuild ]; then
  docker build -q -t "$NAME:latest" . >/dev/null
  run "$NAME:latest"
else
  docker restart "$NAME" >/dev/null
fi

if healthy; then
  echo "Live: $SHA ($(git log -1 --format=%s))"
else
  echo "Addon isn't answering after updating to $SHA. Roll back with: git checkout $OLD && docker restart $NAME" >&2
  docker logs --tail 20 "$NAME" >&2 || true
  exit 1
fi
