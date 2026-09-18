#!/usr/bin/env bash
# Opens AI-Cortex in the default browser, starting the server first if it
# isn't already up. Works whether the server is managed by the ai-cortex
# systemd --user service (preferred — see `npm run setup:desktop`) or not.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2)"
PORT="${PORT:-3001}"
HOST="$(grep -E '^HOST=' "$DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2)"
HOST="${HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"

notify() { command -v notify-send >/dev/null 2>&1 && notify-send -a AI-Cortex "AI-Cortex" "$1"; }

is_up() { curl -fsS "${URL}/api/health" >/dev/null 2>&1; }

if ! is_up; then
  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-unit-files ai-cortex.service >/dev/null 2>&1; then
    systemctl --user start ai-cortex.service 2>/dev/null
  else
    # No systemd unit installed — start it directly, detached.
    NODE="$(command -v node || echo node)"
    cd "$DIR" || { notify "project folder missing"; exit 1; }
    if command -v setsid >/dev/null 2>&1; then
      setsid -f "$NODE" core/api/server.js >> "$DIR/ai-cortex.log" 2>&1 < /dev/null
    else
      nohup "$NODE" core/api/server.js >> "$DIR/ai-cortex.log" 2>&1 < /dev/null &
      disown 2>/dev/null || true
    fi
  fi

  for _ in $(seq 1 50); do
    is_up && break
    sleep 0.2
  done
  is_up || notify "AI-Cortex did not come up — check ai-cortex.log or 'systemctl --user status ai-cortex'"
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL" >/dev/null 2>&1 &
fi
exit 0
