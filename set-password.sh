#!/usr/bin/env bash
# Change the Munin site password (AUTH_PASSWORD) and restart the container.
# Usage:  ./set-password.sh            # prompts (hidden input)
#         ./set-password.sh 'newpass'  # non-interactive
# Changing the password signs out all existing logins (the session cookie is
# signed with the password).
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "${1:-}" ]; then
  NEW="$1"
else
  read -rs -p "New Munin password: " NEW; echo
  read -rs -p "Confirm password:   " NEW2; echo
  [ "$NEW" = "$NEW2" ] || { echo "Passwords do not match."; exit 1; }
fi

[ -n "$NEW" ] || { echo "Empty password, aborting."; exit 1; }
case "$NEW" in
  *"'"*) echo "Please avoid single quotes in the password."; exit 1 ;;
esac

grep -v '^AUTH_PASSWORD=' .env > .env.tmp && mv .env.tmp .env
printf "AUTH_PASSWORD='%s'\n" "$NEW" >> .env
chmod 600 .env
# Keep .env owned by syscall so `docker compose` (run as syscall) can read it,
# even when this script is run from a root shell. No-op when already owned.
chown syscall:syscall .env 2>/dev/null || true
docker compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d >/dev/null 2>&1
echo "Password updated. All existing logins were signed out."
