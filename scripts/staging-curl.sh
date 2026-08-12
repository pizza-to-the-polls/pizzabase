#!/usr/bin/env bash
# Generate a staging SightEngine CURL for a given upload filename.
# Usage: bash scripts/staging-curl.sh <filename>
#        bash scripts/staging-curl.sh portland-or-630201c5.png
#
# Stores the API key in .env (already gitignored) so you don't have to
# pass it every time. Set it once:
#   echo 'STAGING_API_KEY=your-key' >> .env

set -euo pipefail

STAGING_URL="${STAGING_URL:-https://base-next.polls.pizza}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <filename>"
  echo "  e.g. $0 portland-or-630201c5.png"
  exit 1
fi

FILENAME="$1"

# Load .env if it exists and STAGING_API_KEY isn't already set
if [ -z "${STAGING_API_KEY:-}" ] && [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${STAGING_API_KEY:-}" ]; then
  echo "STAGING_API_KEY not set. Add it to .env:"
  echo "  echo 'STAGING_API_KEY=your-key' >> .env"
  exit 1
fi

echo "curl ${STAGING_URL}/uploads/${FILENAME}/sightengine \\"
echo "  -H 'Authorization: Basic ${STAGING_API_KEY}'"