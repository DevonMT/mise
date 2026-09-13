#!/usr/bin/env bash
#
# Put the parse server live: its source, its unit, a restart, and a check.
#
#   npm run deploy:server
#
# The server on the mini was updated by copying files over a git checkout that
# was never pulled, so `git status` there showed 329 changed lines in a file
# that matched this repo exactly. This makes the copy the documented way and
# checks it, instead of leaving the mini's git state to mislead the next reader.
#
# Dependencies are installed only when the lockfile changed.
#
set -euo pipefail

HOST="${MISE_HOST:-dmini}"
ROOT="${MISE_ROOT:-/home/devon/mise}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE/server"

echo "==> typecheck"
npx tsc --noEmit

echo "==> copy"
lock_before=$(ssh "$HOST" "sha256sum '$ROOT/server/package-lock.json' 2>/dev/null | cut -c1-64")
ssh "$HOST" "rm -rf '$ROOT/server/src.incoming'"
scp -qr src "$HOST:$ROOT/server/src.incoming"
scp -q package.json package-lock.json .env.example mise.service "$HOST:$ROOT/server/"
ssh "$HOST" "cd '$ROOT/server' && rm -rf src.prev && mv src src.prev && mv src.incoming src"
lock_after=$(ssh "$HOST" "sha256sum '$ROOT/server/package-lock.json' | cut -c1-64")
if [ "$lock_before" != "$lock_after" ]; then
  echo "==> npm ci (lockfile changed)"
  ssh "$HOST" "cd '$ROOT/server' && npm ci --no-audit --no-fund   # tsx, which runs the server, is a devDependency"
fi

echo "==> unit and restart"
ssh "$HOST" "sudo install -m 0644 '$ROOT/server/mise.service' /etc/systemd/system/mise.service \
  && sudo systemctl daemon-reload && sudo systemctl restart mise"

echo "==> verify"
ssh "$HOST" '
  for i in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://172.30.21.1:8787/api/health) && [ "$code" = 200 ] && break
    sleep 1
  done
  printf "    %-40s %s\n" "/api/health on 172.30.21.1:8787" "$code"
  bound=$(sudo ss -ltnH "sport = :8787" | awk "{print \$4}" | tr "\n" " ")
  printf "    %-40s %s\n" "listening on" "$bound"
  [ "$code" = 200 ] && [ "$bound" = "172.30.21.1:8787 " ]
'
echo "    previous source kept as server/src.prev"
