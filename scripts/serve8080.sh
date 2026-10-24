#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8080}"
LOG="/tmp/axiom-serve8080.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting axiom serve $PORT (bash $BASHPID)" >> "$LOG"
npx tsx src/cli.ts serve "$PORT" >> "$LOG" 2>&1 &
NPID=$!
echo "$NPID" > /tmp/axiom-serve8080.pid
echo "[$(date '+%Y-%m-%d %H:%M:%S')] launched pid=$NPID" >> "$LOG"
wait "$NPID"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] pid $NPID exited with $?" >> "$LOG"
