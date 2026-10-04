#!/usr/bin/env bash
# Starts a single-node Apache Kafka 4.1.2 KRaft broker from .local/ (see setup.sh).
# Listeners (all bound to loopback):
#   19092 PLAINTEXT  development only
#   19093 SSL        TLS with the generated local CA (.local/kafka-certs/ca.pem)
#   19094 SASL_SSL   TLS + SASL PLAIN / SCRAM-SHA-256 / SCRAM-SHA-512 (user streamotter)
# Data persists in .local/kafka-data across restarts; pass --reset to wipe it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
KAFKA="$LOCAL/kafka"
DATA="$LOCAL/kafka-data"
CERTS="$LOCAL/kafka-certs"
CONFIG="$LOCAL/kafka-server.properties"
PIDFILE="$LOCAL/kafka.pid"
LOG="$LOCAL/kafka.log"
SASL_USER="streamotter"
SASL_PASSWORD="streamotter-local-secret"

if [ ! -x "$KAFKA/bin/kafka-server-start.sh" ]; then
  echo "Kafka is not installed; run ./scripts/kafka/setup.sh first." >&2
  exit 1
fi
if [ -x "$LOCAL/jdk/bin/java" ]; then
  export JAVA_HOME="$LOCAL/jdk"
elif ! command -v java >/dev/null; then
  echo "No Java found: .local/jdk is missing and java is not on PATH. Run ./scripts/kafka/setup.sh, or install a JDK 17 or newer." >&2
  exit 1
fi

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

if [ "${1:-}" = "--reset" ]; then
  "$ROOT/scripts/kafka/stop.sh" >/dev/null 2>&1 || true
  rm -rf "$DATA"
fi

if [ -f "$PIDFILE" ]; then
  if owns "$(cat "$PIDFILE")" "$CONFIG"; then
    echo "Kafka is already running (pid $(cat "$PIDFILE"))."
    exit 0
  fi
  rm -f "$PIDFILE"
fi

# Something else (another checkout's broker, say) already holding a listener port would both make this
# broker fail to bind and answer the readiness probe below, so refuse up front.
for port in 19092 19093 19094 19095; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "Port $port is already in use by another process (another checkout's broker?); stop it first." >&2
    exit 1
  fi
done

# Local TLS material: a throwaway CA and a broker certificate for localhost/127.0.0.1.
if [ ! -f "$CERTS/broker-keystore.pem" ]; then
  mkdir -p "$CERTS"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=StreamOtter Local Kafka CA" \
    -keyout "$CERTS/ca-key.pem" -out "$CERTS/ca.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" \
    -keyout "$CERTS/broker-key.rsa.pem" -out "$CERTS/broker.csr" >/dev/null 2>&1
  printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n" > "$CERTS/broker.ext"
  openssl x509 -req -in "$CERTS/broker.csr" -CA "$CERTS/ca.pem" -CAkey "$CERTS/ca-key.pem" -CAcreateserial \
    -days 3650 -extfile "$CERTS/broker.ext" -out "$CERTS/broker.pem" >/dev/null 2>&1
  openssl pkcs8 -topk8 -nocrypt -in "$CERTS/broker-key.rsa.pem" -out "$CERTS/broker-key.pem"
  cat "$CERTS/broker-key.pem" "$CERTS/broker.pem" > "$CERTS/broker-keystore.pem"
  # A second, unrelated CA for negative TLS tests.
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Untrusted CA" \
    -keyout "$CERTS/untrusted-ca-key.pem" -out "$CERTS/untrusted-ca.pem" >/dev/null 2>&1
fi

cat > "$CONFIG" <<PROPS
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@127.0.0.1:19095
controller.listener.names=CONTROLLER
listeners=PLAINTEXT://127.0.0.1:19092,SSL://127.0.0.1:19093,SASL_SSL://127.0.0.1:19094,CONTROLLER://127.0.0.1:19095
advertised.listeners=PLAINTEXT://127.0.0.1:19092,SSL://localhost:19093,SASL_SSL://localhost:19094
listener.security.protocol.map=PLAINTEXT:PLAINTEXT,SSL:SSL,SASL_SSL:SASL_SSL,CONTROLLER:PLAINTEXT
inter.broker.listener.name=PLAINTEXT
log.dirs=$DATA
num.partitions=3
auto.create.topics.enable=false
offsets.topic.replication.factor=1
offsets.topic.num.partitions=3
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
share.coordinator.state.topic.replication.factor=1
share.coordinator.state.topic.min.isr=1
group.initial.rebalance.delay.ms=0
ssl.keystore.type=PEM
ssl.keystore.location=$CERTS/broker-keystore.pem
ssl.truststore.type=PEM
ssl.truststore.location=$CERTS/ca.pem
ssl.client.auth=none
sasl.enabled.mechanisms=PLAIN,SCRAM-SHA-256,SCRAM-SHA-512
listener.name.sasl_ssl.sasl.enabled.mechanisms=PLAIN,SCRAM-SHA-256,SCRAM-SHA-512
listener.name.sasl_ssl.plain.sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required user_${SASL_USER}="${SASL_PASSWORD}";
listener.name.sasl_ssl.scram-sha-256.sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required;
listener.name.sasl_ssl.scram-sha-512.sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required;
PROPS

if [ ! -f "$DATA/meta.properties" ]; then
  mkdir -p "$DATA"
  CLUSTER_ID="$("$KAFKA/bin/kafka-storage.sh" random-uuid)"
  "$KAFKA/bin/kafka-storage.sh" format -t "$CLUSTER_ID" -c "$CONFIG" \
    --add-scram "SCRAM-SHA-256=[name=${SASL_USER},password=${SASL_PASSWORD}]" \
    --add-scram "SCRAM-SHA-512=[name=${SASL_USER},password=${SASL_PASSWORD}]" >/dev/null
fi

KAFKA_HEAP_OPTS="-Xmx512m -Xms256m" nohup "$KAFKA/bin/kafka-server-start.sh" "$CONFIG" < /dev/null > "$LOG" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 60); do
  if "$KAFKA/bin/kafka-broker-api-versions.sh" --bootstrap-server 127.0.0.1:19092 >/dev/null 2>&1; then
    echo "Kafka 4.1.2 is ready (pid $(cat "$PIDFILE")): PLAINTEXT 127.0.0.1:19092, SSL localhost:19093, SASL_SSL localhost:19094"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Kafka exited during startup; see $LOG" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "Kafka did not become ready within 60 seconds; see $LOG" >&2
exit 1
