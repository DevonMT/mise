#!/usr/bin/env bash
#
# Build Mise and put it live, by swapping the whole directory.
#
#   npm run deploy
#
# WHY A SWAP AND NOT A COPY. Every deploy before this one was `scp -r dist/.`
# into the live directory, which copies files in and never takes any out. The
# served directory had drifted to 17 asset files with 2 of them referenced —
# 3.4MB of chunks from builds nobody runs any more, and no way to tell by
# looking which build was actually live.
#
# A swap also closes a window a copy leaves open: for the seconds an upload is
# in flight, index.html has already been replaced and names a chunk that has
# not arrived yet. Nobody has hit it, because deploys are rare and the app is
# offline-first. It is still a hole, and staging then moving costs nothing.
#
# The previous build is kept as dist.prev, so a bad deploy is one command:
#
#   ssh dmini 'cd /home/devon/mise && rm -rf dist.bad && mv dist dist.bad && mv dist.prev dist'
#
set -euo pipefail

HOST="${MISE_HOST:-dmini}"
ROOT="${MISE_ROOT:-/home/devon/mise}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

echo "==> build"
npm run build

# What the fresh build actually asks for. Checked against the origin at the end,
# so a deploy that half-arrived fails here rather than in somebody's browser.
ENTRY=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)
SHEET=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.css' dist/index.html | head -1)
echo "    entry $ENTRY"
echo "    sheet $SHEET"

echo "==> stage"
ssh "$HOST" "rm -rf '$ROOT/dist.incoming'"
scp -qr dist "$HOST:$ROOT/dist.incoming"

echo "==> swap"
ssh "$HOST" "cd '$ROOT' \
  && rm -rf dist.prev \
  && if [ -d dist ]; then mv dist dist.prev; fi \
  && mv dist.incoming dist"

echo "==> verify from the origin"
ssh "$HOST" "
  fail=0
  for path in '' '$ENTRY' '$SHEET' 'sw.js' 'manifest.webmanifest'; do
    code=\$(curl -s -o /dev/null -w '%{http_code}' \"http://172.30.0.1:8787/\$path\")
    printf '    %-40s %s\n' \"/\$path\" \"\$code\"
    [ \"\$code\" = 200 ] || fail=1
  done
  n=\$(ls '$ROOT/dist/assets' | wc -l)
  printf '    %-40s %s\n' 'asset files in the live bundle' \"\$n\"
  exit \$fail
"
echo "==> live"
