#!/bin/sh
# Usage: smoke.sh <base-url> [expected-revision]
# The deployed console must be healthy, on the expected revision, and serve valid evidence.
set -eu
url="${1%/}"
expected="${2:-}"
for attempt in 1 2 3 4 5; do
  health=$(curl -fsS --max-time 10 "$url/api/health") && break
  [ "$attempt" = 5 ] && { echo "health check failed: $url"; exit 1; }
  sleep 6
done
echo "health: $health"
case "$health" in *'"status":"ok"'*) ;; *) echo "unexpected health payload"; exit 1 ;; esac
if [ -n "$expected" ]; then
  case "$health" in *"$expected"*) ;; *) echo "serving a different revision than $expected"; exit 1 ;; esac
fi
curl -fsS --max-time 15 "$url/api/evidence" | grep -q '"schemaVersion":1' || { echo "evidence endpoint invalid"; exit 1; }
curl -fsS --max-time 10 "$url/api/ledger" | grep -q '"entries"' || { echo "ledger endpoint invalid"; exit 1; }
echo "smoke test passed: $url"
