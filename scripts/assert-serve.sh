#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-8080}"
LOG="/tmp/axiom-serve-keep.log"
MAX_WAIT=40

echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: comprobando puerto $PORT" >> "$LOG"

if lsof -i :"$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: ya estaba escuchando en $PORT" >> "$LOG"
  if curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/" | grep -qE "^(200|301|302|304)$"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: OK, responde" >> "$LOG"
    exit 0
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: puerto ocupado pero no responde; matando" >> "$LOG"
    pkill -f "axiom serve $PORT" 2>/dev/null || true
    pkill -f "keep-serve.sh" 2>/dev/null || true
    sleep 1
  fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: lanzando keep-serve" >> "$LOG"
nohup setsid bash scripts/keep-serve.sh >> "$LOG" 2>&1 < /dev/null & disown
echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: keep pid=$!" >> "$LOG"

for i in $(seq 1 "$MAX_WAIT"); do
  sleep 1
  if lsof -i :"$PORT" 2>/dev/null | grep -q LISTEN; then
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null | grep -qE "^(200|301|302|304)$"; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: OK en intento $i" >> "$LOG"
      echo "OK: axiom serve $PORT listo"
      exit 0
    fi
  fi
  if [ $((i % 5)) -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: tick $i/${MAX_WAIT}" >> "$LOG"
  fi
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] assert-serve: FALLO tras ${MAX_WAIT}s" >> "$LOG"
lsof -i :"$PORT" 2>/dev/null | grep LISTEN || echo "  (sin listener)"
tail -n 5 "$LOG" >&2
exit 1
