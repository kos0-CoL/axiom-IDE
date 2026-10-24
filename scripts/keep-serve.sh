#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="/tmp/axiom-serve-keep.log"
while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] axiom serve 8080 starting" >> "$LOG"
  npx tsx src/cli.ts serve 8080 >> "$LOG" 2>&1 || echo "[$(date '+%Y-%m-%d %H:%M:%S')] tsx devolvió $? (no cero). reiniciando en 2s..." >> "$LOG"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] axiom serve 8080 exited with $?. restarting in 2s..." >> "$LOG"
  sleep 2
done
