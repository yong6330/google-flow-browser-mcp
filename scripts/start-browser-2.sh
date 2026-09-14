#!/usr/bin/env bash
# macOS launcher for the Flow automation Chrome.
# Uses a DEDICATED profile so the user's main Chrome is untouched and stays running.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="$HOME/.flow-chrome-2"
CDP_PORT=9223
FLOW_URL="${1:-https://labs.google/fx/fr/tools/flow}"

log() { echo "[flow-chrome] $*" >&2; }

[[ -x "$CHROME" ]] || { log "ERROR Chrome not found at $CHROME"; exit 1; }

if curl -sf "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
  log "already up on :$CDP_PORT"
  exit 0
fi

if lsof -ti :$CDP_PORT >/dev/null 2>&1; then
  log "port $CDP_PORT occupied but not answering CDP — killing"
  lsof -ti :$CDP_PORT | xargs kill 2>/dev/null || true
  sleep 2
fi

mkdir -p "$USER_DATA_DIR"
log "launching dedicated Flow Chrome (profile: $USER_DATA_DIR)"

"$CHROME" \
  --user-data-dir="$USER_DATA_DIR" \
  --remote-debugging-port="$CDP_PORT" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-component-update \
  --disable-features=ChromeWhatsNewUI \
  "$FLOW_URL" \
  >/dev/null 2>&1 &

for i in $(seq 1 20); do
  if curl -sf "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
    log "CDP ready on :$CDP_PORT"
    exit 0
  fi
  sleep 1
done

log "ERROR Chrome did not expose CDP on :$CDP_PORT within 20s"
exit 1
