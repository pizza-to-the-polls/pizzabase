#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL=""
QUICK_MODE=false

usage() {
  echo "Usage: $0 [--quick] <health-url>"
  echo "  --quick   Single ping (2 retries, 2s apart). Use to wake up Aurora before migrations."
  echo "            Default: full check (10 retries, 5s apart) for post-deploy verification."
  exit 1
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      HEALTH_URL="$1"
      shift
      ;;
  esac
done

if [ -z "$HEALTH_URL" ]; then
  usage
fi

if $QUICK_MODE; then
  MAX_RETRIES=3
  RETRY_DELAY=2
else
  MAX_RETRIES=10
  RETRY_DELAY=5
fi

echo "Checking health at $HEALTH_URL (mode: $($QUICK_MODE && echo quick || echo full), max ${MAX_RETRIES} retries, ${RETRY_DELAY}s apart)..."
echo ""

for i in $(seq 1 "$MAX_RETRIES"); do
  echo "  Attempt $i/$MAX_RETRIES..."

  RESP=$(curl -fsS --max-time 10 "$HEALTH_URL" 2>&1) && rc=$? || rc=$?

  if [ "$rc" -eq 0 ]; then
    if echo "$RESP" | grep -q '"success":\s*true'; then
      echo "  ✓ Health check passed: $RESP"
      exit 0
    fi
    echo "  ⚠  HTTP 200 but unexpected body: $RESP"
  else
    echo "  ✗ Failed (curl exit code $rc): $RESP"
  fi

  if [ "$i" -lt "$MAX_RETRIES" ]; then
    sleep "$RETRY_DELAY"
  fi
done

echo ""
echo "✗✗✗ HEALTH CHECK FAILED after $MAX_RETRIES attempts ✗✗✗"
exit 1