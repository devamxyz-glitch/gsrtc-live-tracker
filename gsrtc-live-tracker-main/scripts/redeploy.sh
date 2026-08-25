#!/usr/bin/env bash
# Ship whatever is on origin/main to the live server.
#
#   ./scripts/redeploy.sh
#
# Pushes nothing itself — commit and push first, then run this. The server pulls from the
# private repo with its own read-only deploy key, so no credentials travel from here.
set -euo pipefail

HOST="${ST_HOST:-ubuntu@130.210.21.111}"
KEY="${ST_KEY:-$HOME/.ssh/st-tracker-deploy}"
URL="${ST_URL:-https://tracker.shivrajsinh.in}"

ssh_run() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "$@"; }

echo "→ Deploying to $HOST"

LOCAL_HEAD="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "  ! working tree is dirty — the server deploys origin/main, not your local edits"
fi
if ! git diff --quiet HEAD origin/main 2>/dev/null; then
  echo "  ! HEAD ($LOCAL_HEAD) differs from origin/main — did you push?"
fi

ssh_run 'set -e
  cd ~/st-tracker
  git fetch --quiet origin
  git reset --hard --quiet origin/main
  npm install --omit=dev --silent >/dev/null 2>&1
  pm2 restart st-tracker --update-env >/dev/null
  echo "  deployed: $(git log --oneline -1)"'

# pm2 reports "online" the instant it forks, which is well before the port is listening.
echo "→ Waiting for health"
for i in $(seq 1 15); do
  if VERSION=$(curl -fsS -m 10 "$URL/api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'); then
    [[ -n "$VERSION" ]] && { echo "  live: v$VERSION at $URL"; exit 0; }
  fi
  sleep 2
done

echo "  ✗ health check never passed. Check: ssh -i $KEY $HOST 'pm2 logs st-tracker --lines 40'"
exit 1
