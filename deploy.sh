#!/bin/sh
# Deploy the addon to the home server in one step: ./deploy.sh
#   ./deploy.sh            deploy origin/main
#   ./deploy.sh <ref>      deploy a branch, tag or commit
#   ./deploy.sh status     show which commit is live
# Runs on your own machine. Ships the code over SSH with git archive (the server never needs
# GitHub access), rebuilds the image, recreates the container and rolls back if it doesn't come up.
# providers.json on the server is never touched.
set -eu

HOST=${DEPLOY_HOST:-tnv@192.168.1.199}
DIR=${DEPLOY_DIR:-StremioAggregator}
NAME=stremio-aggregator
cd "$(dirname "$0")"

if [ "${1:-}" = status ]; then
  ssh "$HOST" "docker inspect $NAME --format '{{index .Config.Labels \"revision\"}} up since {{.State.StartedAt}}' 2>/dev/null || echo 'not running'"
  exit 0
fi

REF=${1:-origin/main}
git fetch -q origin
SHA=$(git rev-parse --short "$REF^{commit}")
echo "Deploying $SHA ($(git log -1 --format=%s "$SHA")) to $HOST"

# Test the exact commit being shipped, not whatever is checked out.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git archive "$SHA" | tar -x -C "$TMP"
(cd "$TMP" && node --test test/*.test.js >/dev/null) || { echo "Tests failed, not deploying"; exit 1; }

# deploy-remote.sh is taken from the commit being deployed too, so its run options always match.
git archive "$SHA" src package.json Dockerfile .dockerignore deploy-remote.sh |
  ssh "$HOST" "cd ~/$DIR && rm -rf .incoming && mkdir .incoming && tar -x -C .incoming && SHA=$SHA NAME=$NAME DIR=$DIR sh .incoming/deploy-remote.sh"
