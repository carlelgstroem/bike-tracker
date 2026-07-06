#!/usr/bin/env bash
# Re-point Munin's BASE_URL at whatever URL ngrok currently has, then restart.
# Run this after the ngrok URL changes (e.g. a server reboot). It prints the
# redirect URI to (re)register in the WHOOP developer dashboard.
set -euo pipefail
cd "$(dirname "$0")"

URL=$(curl -s http://localhost:4040/api/tunnels \
  | grep -o '"public_url":"https:[^"]*"' | head -1 \
  | sed 's/"public_url":"//;s/"$//')

if [ -z "${URL:-}" ]; then
  echo "Could not read the ngrok URL — is the munin-ngrok container running?"
  echo "  docker compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d"
  exit 1
fi

grep -v '^BASE_URL=' .env > .env.tmp && mv .env.tmp .env
echo "BASE_URL=$URL" >> .env
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d >/dev/null 2>&1

echo
echo "  BASE_URL updated to:  $URL"
echo "  Register in WHOOP:    $URL/auth/whoop/callback"
echo
