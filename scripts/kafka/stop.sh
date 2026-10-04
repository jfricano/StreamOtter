#!/usr/bin/env bash
# Stops the local broker started by start.sh (graceful SIGTERM, then SIGKILL after 30 s).
set -euo pipefail
# Physical path (pwd -P), so the same checkout reached through a symbolic link names the same config
# file on the broker's command line and still recognizes its own broker.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PIDFILE="$ROOT/.local/kafka.pid"
CONFIG="$ROOT/.local/kafka-server.properties"

# True when the live process names this checkout's broker config on its command line, so a stale pid
# file whose pid now belongs to another process (or another checkout's broker) is never trusted. The
# command line reads as empty for a moment while the start script execs into java, so an empty read
# is retried. Uses ps rather than /proc so it also works on macOS; -ww keeps the command line whole.
# The path must follow a space, so /other/repo/.local/... never matches. Returns 2 (rather than 1) when
# the process is still a Kafka broker started with some other config path, so callers keep its pid file.
owns() {
  local pid="$1" config="$2" cmdline
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 1
    cmdline="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
    if [ -n "$cmdline" ]; then
      case "$cmdline" in
        *" $config"|*" $config "*) return 0 ;;
        *" kafka.Kafka "*|*"/kafka-server-start.sh "*) return 2 ;;
        *) return 1 ;;
      esac
    fi
    sleep 0.1
  done
  return 1
}

if [ ! -f "$PIDFILE" ]; then echo "Kafka is not running."; exit 0; fi
PID="$(cat "$PIDFILE")"
status=0
owns "$PID" "$CONFIG" || status=$?
if [ "$status" = 2 ]; then
  echo "Warning: $PIDFILE names a running Kafka process (pid $PID) whose command line does not name $CONFIG; left it running and kept the pid file. Stop it yourself if it is this checkout's broker." >&2
  exit 1
elif [ "$status" != 0 ]; then
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
