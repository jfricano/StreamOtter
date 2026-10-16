#!/usr/bin/env bash
# Starts a single-node Apache Kafka 4.1.2 KRaft broker with authorization enabled, from .local/ (see
# setup.sh), for the ACL tier (tests/kafka-acl). It is a local fixture, not a deployment recipe.
# Listeners (all bound to loopback):
#   39092 SASL_PLAINTEXT  PLAIN, user admin (a super user): test setup, ACL changes, inter-broker traffic
#   39094 SASL_SSL        TLS with a generated local CA (.local/kafka-acl/certs/ca.pem) + SCRAM-SHA-512,
#                         user streamotter-gateway, which has no ACLs until a test grants them
#   39095 CONTROLLER      SASL_PLAINTEXT, PLAIN, user admin
# The authorizer is StandardAuthorizer with allow.everyone.if.no.acl.found=false, so only super.users
# (User:admin) can do anything without an ACL. It never touches the broker from start.sh or the
# replicated cluster. Data persists in .local/kafka-acl across restarts; pass --reset to wipe it.
set -euo pipefail

# Physical path (pwd -P), so the same checkout reached through a symbolic link names the same config
# file on the broker's command line and still recognizes its own broker.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
LOCAL="$ROOT/.local"
KAFKA="$LOCAL/kafka"
BASE="$LOCAL/kafka-acl"
DATA="$BASE/data"
CERTS="$BASE/certs"
CONFIG="$BASE/server.properties"
ADMIN_CONFIG="$BASE/admin.properties"
PIDFILE="$BASE/pid"
LOG="$BASE/server.out"
ADMIN_USER="admin"
ADMIN_PASSWORD="streamotter-acl-admin-secret"
GATEWAY_USER="streamotter-gateway"
GATEWAY_PASSWORD="streamotter-acl-gateway-secret"

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

# True when the live process names this broker's config file on its command line, so a stale pid
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

case "${1:-}" in
  --reset)
    "$ROOT/scripts/kafka/acl-stop.sh" >/dev/null 2>&1 || true
    rm -rf "$BASE"
    ;;
  "") ;;
  *) echo "Usage: $0 [--reset]" >&2; exit 2 ;;
esac
mkdir -p "$BASE/logs"

if [ -f "$PIDFILE" ]; then
  status=0
  owns "$(cat "$PIDFILE")" "$CONFIG" || status=$?
  if [ "$status" = 0 ]; then
    echo "The ACL broker is already running (pid $(cat "$PIDFILE"))."
    exit 0
  elif [ "$status" = 2 ]; then
    echo "Warning: $PIDFILE names a running Kafka process (pid $(cat "$PIDFILE")) whose command line does not name $CONFIG; left it running and kept the pid file. Stop it yourself if it is this checkout's ACL broker." >&2
    exit 1
  fi
  rm -f "$PIDFILE"
fi

# Something else (another checkout's broker, say) already holding a listener port would both make this
# broker fail to bind and answer the readiness probe below, so refuse up front.
for port in 39092 39094 39095; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "Port $port is already in use by another process (another checkout's ACL broker?); stop it first." >&2
    exit 1
  fi
done

# Local TLS material: a throwaway CA and a broker certificate for localhost/127.0.0.1.
if [ ! -f "$CERTS/broker-keystore.pem" ]; then
  mkdir -p "$CERTS"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=StreamOtter Local Kafka ACL CA" \
    -keyout "$CERTS/ca-key.pem" -out "$CERTS/ca.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" \
    -keyout "$CERTS/broker-key.rsa.pem" -out "$CERTS/broker.csr" >/dev/null 2>&1
  printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n" > "$CERTS/broker.ext"
  openssl x509 -req -in "$CERTS/broker.csr" -CA "$CERTS/ca.pem" -CAkey "$CERTS/ca-key.pem" -CAcreateserial \
    -days 3650 -extfile "$CERTS/broker.ext" -out "$CERTS/broker.pem" >/dev/null 2>&1
  openssl pkcs8 -topk8 -nocrypt -in "$CERTS/broker-key.rsa.pem" -out "$CERTS/broker-key.pem"
  cat "$CERTS/broker-key.pem" "$CERTS/broker.pem" > "$CERTS/broker-keystore.pem"
fi

PLAIN_JAAS="org.apache.kafka.common.security.plain.PlainLoginModule required username=\"${ADMIN_USER}\" password=\"${ADMIN_PASSWORD}\" user_${ADMIN_USER}=\"${ADMIN_PASSWORD}\";"
cat > "$CONFIG" <<PROPS
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@127.0.0.1:39095
controller.listener.names=CONTROLLER
listeners=INTERNAL://127.0.0.1:39092,SASL_SSL://127.0.0.1:39094,CONTROLLER://127.0.0.1:39095
advertised.listeners=INTERNAL://127.0.0.1:39092,SASL_SSL://localhost:39094
listener.security.protocol.map=INTERNAL:SASL_PLAINTEXT,SASL_SSL:SASL_SSL,CONTROLLER:SASL_PLAINTEXT
inter.broker.listener.name=INTERNAL
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.mechanism.controller.protocol=PLAIN
authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer
super.users=User:${ADMIN_USER}
allow.everyone.if.no.acl.found=false
log.dirs=$DATA
num.partitions=1
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
listener.name.internal.sasl.enabled.mechanisms=PLAIN
listener.name.internal.plain.sasl.jaas.config=$PLAIN_JAAS
listener.name.controller.sasl.enabled.mechanisms=PLAIN
listener.name.controller.plain.sasl.jaas.config=$PLAIN_JAAS
listener.name.sasl_ssl.sasl.enabled.mechanisms=SCRAM-SHA-512
listener.name.sasl_ssl.scram-sha-512.sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required;
PROPS

# Client settings for Kafka's command-line tools as the admin user.
cat > "$ADMIN_CONFIG" <<PROPS
security.protocol=SASL_PLAINTEXT
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="${ADMIN_USER}" password="${ADMIN_PASSWORD}";
PROPS

if [ ! -f "$DATA/meta.properties" ]; then
  mkdir -p "$DATA"
  CLUSTER_ID="$("$KAFKA/bin/kafka-storage.sh" random-uuid)"
  LOG_DIR="$BASE/logs" "$KAFKA/bin/kafka-storage.sh" format -t "$CLUSTER_ID" -c "$CONFIG" \
    --add-scram "SCRAM-SHA-512=[name=${GATEWAY_USER},password=${GATEWAY_PASSWORD}]" >/dev/null
fi

LOG_DIR="$BASE/logs" KAFKA_HEAP_OPTS="-Xmx512m -Xms256m" nohup "$KAFKA/bin/kafka-server-start.sh" "$CONFIG" < /dev/null > "$LOG" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 60); do
  if LOG_DIR="$BASE/logs" "$KAFKA/bin/kafka-broker-api-versions.sh" --bootstrap-server 127.0.0.1:39092 --command-config "$ADMIN_CONFIG" >/dev/null 2>&1; then
    echo "Kafka 4.1.2 with ACLs is ready (pid $(cat "$PIDFILE")): SASL_PLAINTEXT 127.0.0.1:39092 (admin), SASL_SSL localhost:39094 (${GATEWAY_USER})"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "The ACL broker exited during startup; see $LOG and $BASE/logs" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "The ACL broker did not become ready within 60 seconds; see $LOG and $BASE/logs" >&2
exit 1
