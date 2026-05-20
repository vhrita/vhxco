#!/usr/bin/env bash
# qa/dev-and-shots.sh
# Orchestration helper: kill port → start dev server → wait → run take-shots → kill dev server.
#
# Usage:
#   bash qa/dev-and-shots.sh [--viewports 375,1280] [--phase 1] [--out qa/screenshots/custom]
#
# All args are passed through to take-shots.mjs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$REPO_ROOT/qa/.dev.pid"
LOG_FILE="$REPO_ROOT/qa/.dev.log"
PORT=4321
TIMEOUT=60

# ── Cleanup on exit ───────────────────────────────────────────────────────────

cleanup() {
  if [ -f "$PID_FILE" ]; then
    DEV_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
      echo "[qa] stopping dev server (pid $DEV_PID)..."
      kill "$DEV_PID" 2>/dev/null || true
      # Wait briefly for graceful shutdown
      sleep 1
      kill -9 "$DEV_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# ── Kill anything already on the port ────────────────────────────────────────

echo "[qa] checking port $PORT..."
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
sleep 1

# ── Start dev server ──────────────────────────────────────────────────────────

echo "[qa] starting pnpm dev (log: $LOG_FILE)..."
cd "$REPO_ROOT"
pnpm dev > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "[qa] dev server pid: $(cat "$PID_FILE")"

# ── Wait for server to be ready ───────────────────────────────────────────────

echo "[qa] waiting for http://localhost:$PORT (timeout: ${TIMEOUT}s)..."
ELAPSED=0
until curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" | grep -qE "^(200|304)$"; do
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "[qa] TIMEOUT: dev server did not respond after ${TIMEOUT}s"
    echo "[qa] last dev log lines:"
    tail -20 "$LOG_FILE" || true
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  echo "[qa]   ...${ELAPSED}s"
done

echo "[qa] server ready!"

# ── Run take-shots ────────────────────────────────────────────────────────────

echo "[qa] running take-shots.mjs $*"
node "$REPO_ROOT/qa/take-shots.mjs" "$@"
echo "[qa] take-shots done."

# cleanup() will fire via trap EXIT and kill dev server
