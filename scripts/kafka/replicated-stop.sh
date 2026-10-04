#!/usr/bin/env bash
# Stops the replicated cluster started by replicated-start.sh. Never touches the
# single-node broker from start.sh.
#
# Usage:
#   replicated-stop.sh                  stop every node (brokers first), SIGTERM then SIGKILL after 30 s
#   replicated-stop.sh --node ID        stop one node gracefully (1-3 or 101-103)
#   replicated-stop.sh --node ID --kill SIGKILL one node immediately (a crash, for failure tests)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$ROOT/.local/kafka-replicated"

# Prints the node's pid when its pidfile names a live process started with its own config file.
live_pid() {
  local dir="$BASE/node-$1"
  [ -f "$dir/pid" ] || return 1
  local pid; pid="$(cat "$dir/pid")"
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "$dir/server.properties" || return 1
  echo "$pid"
}

stop_node() {
  local id="$1" signal="$2" dir="$BASE/node-$1" pid
  if ! pid="$(live_pid "$id")"; then
    rm -f "$dir/pid"
    echo "Node $id is not running."
    return 0
  fi
  if [ "$signal" = "KILL" ]; then
    kill -9 "$pid"
  else
    kill "$pid"
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  fi
  # Wait for the process to be gone, so a following start never races the old one for its port and lock.
  for _ in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  rm -f "$dir/pid"
  echo "Node $id stopped (SIG$signal)."
}

case "${1:-}" in
  --node)
    id="${2:?--node needs a node ID (1-3 or 101-103)}"
    case "$id" in 1|2|3|101|102|103) ;; *) echo "Unknown node $id; brokers are 1-3 and controllers 101-103." >&2; exit 2 ;; esac
    signal="TERM"
    [ "${3:-}" = "--kill" ] && signal="KILL"
    stop_node "$id" "$signal"
    ;;
  "")
    # Brokers stop in parallel, then the controllers, so brokers can still deregister cleanly.
    for id in 1 2 3; do stop_node "$id" TERM & done
    wait
    for id in 101 102 103; do stop_node "$id" TERM & done
    wait
    echo "Replicated Kafka stopped."
    ;;
  *) echo "Usage: $0 [--node ID [--kill]]" >&2; exit 2 ;;
esac
