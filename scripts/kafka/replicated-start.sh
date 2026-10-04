#!/usr/bin/env bash
# Starts a replicated Apache Kafka 4.1.2 KRaft cluster from .local/ for the
# replicated-broker evidence tier (tests/kafka-replicated, acceptance F47).
# Everything is bound to loopback and uses PLAINTEXT; it is a local fixture,
# not a deployment recipe.
#
#   brokers      node.id 1, 2, 3        127.0.0.1:29092, :29093, :29094
#   controllers  node.id 101, 102, 103  127.0.0.1:29192, :29193, :29194
#
# The controllers are dedicated processes so that killing brokers never costs
# the KRaft quorum: with two of three brokers down the controller still fences
# them and shrinks ISRs, which is what makes NOT_ENOUGH_REPLICAS observable.
# Cluster defaults: default.replication.factor=3, min.insync.replicas=1 (topics
# that need more set it themselves), unclean.leader.election.enable=false,
# internal topics with replication factor 3.
#
# Usage:
#   replicated-start.sh              start every node that is not running, then wait for 3 brokers
#   replicated-start.sh --node ID    start one node (1-3 or 101-103) and wait for it to answer
#   replicated-start.sh --reset      stop everything, wipe .local/kafka-replicated, start fresh
# Data persists in .local/kafka-replicated across restarts. Safe to rerun.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
KAFKA="$LOCAL/kafka"
BASE="$LOCAL/kafka-replicated"
BROKERS=(1 2 3)
CONTROLLERS=(101 102 103)
BOOTSTRAP="127.0.0.1:29092,127.0.0.1:29093,127.0.0.1:29094"
VOTERS="101@127.0.0.1:29192,102@127.0.0.1:29193,103@127.0.0.1:29194"

if [ ! -x "$KAFKA/bin/kafka-server-start.sh" ]; then
  echo "Kafka is not installed; run ./scripts/kafka/setup.sh first." >&2
  exit 1
fi
if [ -x "$LOCAL/jdk/bin/java" ]; then export JAVA_HOME="$LOCAL/jdk"; fi
# Kafka's scripts write logs under the installation unless told otherwise; keep them here.
mkdir -p "$BASE/tool-logs"
export LOG_DIR="$BASE/tool-logs"

port_of() {
  case "$1" in
    1|2|3) echo $((29091 + $1)) ;;
    101|102|103) echo $((29091 + $1)) ;;
    *) echo "Unknown node $1; brokers are 1-3 and controllers 101-103." >&2; exit 2 ;;
  esac
}

# A node is running when its pidfile names a live process started with its own config file.
running() {
  local dir="$BASE/node-$1"
  [ -f "$dir/pid" ] || return 1
  local pid; pid="$(cat "$dir/pid")"
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "$dir/server.properties"
}

write_config() {
  local id="$1" dir="$BASE/node-$1" port; port="$(port_of "$1")"
  mkdir -p "$dir/data" "$dir/logs"
  if [ "$id" -ge 100 ]; then
    cat > "$dir/server.properties" <<PROPS
process.roles=controller
node.id=$id
controller.quorum.voters=$VOTERS
controller.listener.names=CONTROLLER
listeners=CONTROLLER://127.0.0.1:$port
listener.security.protocol.map=CONTROLLER:PLAINTEXT
log.dirs=$dir/data
PROPS
  else
    cat > "$dir/server.properties" <<PROPS
process.roles=broker
node.id=$id
controller.quorum.voters=$VOTERS
controller.listener.names=CONTROLLER
listeners=PLAINTEXT://127.0.0.1:$port
advertised.listeners=PLAINTEXT://127.0.0.1:$port
listener.security.protocol.map=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
inter.broker.listener.name=PLAINTEXT
log.dirs=$dir/data
num.partitions=1
default.replication.factor=3
min.insync.replicas=1
unclean.leader.election.enable=false
auto.create.topics.enable=false
offsets.topic.replication.factor=3
offsets.topic.num.partitions=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
share.coordinator.state.topic.replication.factor=3
share.coordinator.state.topic.min.isr=2
group.initial.rebalance.delay.ms=0
PROPS
  fi
}

cluster_id() {
  if [ ! -f "$BASE/cluster-id" ]; then
    "$KAFKA/bin/kafka-storage.sh" random-uuid > "$BASE/cluster-id"
  fi
  cat "$BASE/cluster-id"
}

launch() {
  local id="$1" dir="$BASE/node-$1"
  if running "$id"; then
    echo "Node $id is already running (pid $(cat "$dir/pid"))."
    return 0
  fi
  write_config "$id"
  if [ ! -f "$dir/data/meta.properties" ]; then
    "$KAFKA/bin/kafka-storage.sh" format -t "$(cluster_id)" -c "$dir/server.properties" >/dev/null
  fi
  local heap="-Xmx512m -Xms256m"
  [ "$id" -ge 100 ] && heap="-Xmx256m -Xms128m"
  LOG_DIR="$dir/logs" KAFKA_HEAP_OPTS="$heap" nohup "$KAFKA/bin/kafka-server-start.sh" "$dir/server.properties" \
    < /dev/null > "$dir/server.out" 2>&1 &
  echo $! > "$dir/pid"
  echo "Started node $id (pid $!)."
}

# Waits until the node accepts connections on its listener; a broker must also answer API requests.
wait_node() {
  local id="$1" dir="$BASE/node-$1" port; port="$(port_of "$1")"
  for _ in $(seq 1 90); do
    if ! running "$id"; then
      echo "Node $id exited during startup; see $dir/server.out and $dir/logs" >&2
      tail -20 "$dir/server.out" >&2 || true
      exit 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      if [ "$id" -ge 100 ] || "$KAFKA/bin/kafka-broker-api-versions.sh" --bootstrap-server "127.0.0.1:$port" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "Node $id did not become ready within 90 seconds; see $dir/logs" >&2
  exit 1
}

# Waits until the cluster metadata lists all three brokers.
wait_cluster() {
  for _ in $(seq 1 90); do
    local listed
    listed="$("$KAFKA/bin/kafka-broker-api-versions.sh" --bootstrap-server "$BOOTSTRAP" 2>/dev/null | grep -c '^127\.0\.0\.1:2909[234] (id: [123] ' || true)"
    if [ "$listed" = "3" ]; then return 0; fi
    sleep 1
  done
  echo "The replicated cluster did not list three brokers within 90 seconds; see $BASE/node-*/logs" >&2
  exit 1
}

case "${1:-}" in
  --reset)
    "$ROOT/scripts/kafka/replicated-stop.sh" >/dev/null 2>&1 || true
    rm -rf "$BASE"
    mkdir -p "$BASE/tool-logs"
    ;;
  --node)
    id="${2:?--node needs a node ID (1-3 or 101-103)}"
    port_of "$id" >/dev/null
    launch "$id"
    wait_node "$id"
    echo "Node $id is ready on 127.0.0.1:$(port_of "$id")."
    exit 0
    ;;
  "") ;;
  *) echo "Usage: $0 [--reset | --node ID]" >&2; exit 2 ;;
esac

for id in "${CONTROLLERS[@]}"; do launch "$id"; done
for id in "${CONTROLLERS[@]}"; do wait_node "$id"; done
for id in "${BROKERS[@]}"; do launch "$id"; done
for id in "${BROKERS[@]}"; do wait_node "$id"; done
wait_cluster
echo "Replicated Kafka 4.1.2 is ready: brokers $BOOTSTRAP (PLAINTEXT), controllers 127.0.0.1:29192-29194"
