#!/bin/sh
# Deploy the addon to the home server in one step: ./deploy.sh
#   ./deploy.sh            deploy origin/main
#   ./deploy.sh status     show which commit is live
# The server pulls from GitHub itself (read-only deploy key) and runs update.sh.
set -eu

HOST=${DEPLOY_HOST:-tnv@192.168.1.199}
DIR=${DEPLOY_DIR:-StremioAggregator}

if [ "${1:-}" = status ]; then
  ssh "$HOST" "docker inspect stremio-aggregator --format '{{index .Config.Labels \"revision\"}} up since {{.State.StartedAt}}' 2>/dev/null || echo 'not running'"
else
  ssh "$HOST" "cd ~/$DIR && ./update.sh"
fi
