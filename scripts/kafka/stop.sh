#!/usr/bin/env bash
# Stops the local broker started by start.sh (graceful SIGTERM, then SIGKILL after 30 s).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="$ROOT/.local/kafka.pid"
if [ ! -f "$PIDFILE" ]; then echo "Kafka is not running."; exit 0; fi
PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in $(seq 1 30); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
fi
rm -f "$PIDFILE"
echo "Kafka stopped."
