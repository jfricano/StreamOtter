#!/usr/bin/env bash
# Stops the replicated cluster started by replicated-start.sh. Never touches the
# single-node broker from start.sh.
#
# Usage:
#   replicated-stop.sh                  stop every node (brokers first), SIGTERM then SIGKILL after 30 s
#   replicated-stop.sh --node ID        stop one node gracefully (1-3 or 101-103)
#   replicated-stop.sh --node ID --kill SIGKILL one node immediately (a crash, for failure tests)
set -euo pipefail

# Physical path (pwd -P), so the same checkout reached through a symbolic link names the same config
# file on the broker's command line and still recognizes its own broker.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
BASE="$ROOT/.local/kafka-replicated"

# True when the live process names the node's config file on its command line. The command line
# reads as empty for a moment while the start scripts exec into java, so an empty read is retried.
# Uses ps rather than /proc so it also works on macOS; -ww keeps Kafka's long command line whole.
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

# Prints the node's pid when its pidfile names a live process started with its own config file; returns 2 as owns does.
live_pid() {
  local dir="$BASE/node-$1"
  [ -f "$dir/pid" ] || return 1
  local pid; pid="$(cat "$dir/pid")"
  owns "$pid" "$dir/server.properties" || return $?
  echo "$pid"
}

stop_node() {
  local id="$1" signal="$2" dir="$BASE/node-$1" pid status=0
  pid="$(live_pid "$id")" || status=$?
  if [ "$status" = 2 ]; then
    echo "Warning: $dir/pid names a running Kafka process (pid $(cat "$dir/pid")) whose command line does not name $dir/server.properties; left node $id running and kept the pid file." >&2
    return 1
  elif [ "$status" != 0 ]; then
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
