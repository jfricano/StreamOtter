#!/usr/bin/env bash
# Stops the local broker started by start.sh (graceful SIGTERM, then SIGKILL after 30 s).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="$ROOT/.local/kafka.pid"
CONFIG="$ROOT/.local/kafka-server.properties"

# True when the live process names this checkout's broker config on its command line, so a stale pid
# file whose pid now belongs to another process (or another checkout's broker) is never trusted. The
# command line reads as empty for a moment while the start script execs into java, so an empty read
# is retried. Uses ps rather than /proc so it also works on macOS; -ww keeps the command line whole.
owns() {
  local pid="$1" config="$2" cmdline
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 1
    cmdline="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
    if [ -n "$cmdline" ]; then
      case "$cmdline" in *"$config"*) return 0 ;; *) return 1 ;; esac
    fi
    sleep 0.1
  done
  return 1
}

if [ ! -f "$PIDFILE" ]; then echo "Kafka is not running."; exit 0; fi
PID="$(cat "$PIDFILE")"
if ! owns "$PID" "$CONFIG"; then
  rm -f "$PIDFILE"
  echo "Kafka is not running (removed a stale pid file)."
  exit 0
fi
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
