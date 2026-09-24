#!/usr/bin/env bash
# Downloads a pinned, checksum-verified JDK and Apache Kafka 4.1.2 into .local/
# for running a native KRaft broker without Docker. Delete .local/ to undo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
KAFKA_VERSION="4.1.2"
KAFKA_TGZ="kafka_2.13-${KAFKA_VERSION}.tgz"
KAFKA_URL="https://archive.apache.org/dist/kafka/${KAFKA_VERSION}/${KAFKA_TGZ}"
KAFKA_SHA512="78ac6e488b1071122f9608dfdb363f6fe50e1dbbc492347002c0398dfbf77e0d8caa5bf794c5937379721004dfe92025937d238b0faf4eb715529417fd43b491"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64)
    JDK_TGZ="OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12.1_1.tar.gz"
    JDK_SHA256="3623232f33a9c3baadf304480b2535f9a3cba8a58d42ecbb438ba267315d9998" ;;
  *)
    JDK_TGZ=""; JDK_SHA256="" ;;
esac
JDK_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/${JDK_TGZ}"

mkdir -p "$LOCAL/downloads"

if [ -x "$LOCAL/jdk/bin/java" ]; then
  echo "JDK already present at .local/jdk"
elif [ -n "$JDK_TGZ" ]; then
  echo "Downloading $JDK_TGZ"
  curl -fsSL --retry 3 -o "$LOCAL/downloads/$JDK_TGZ" "$JDK_URL"
  echo "$JDK_SHA256  $LOCAL/downloads/$JDK_TGZ" | shasum -a 256 -c -
  rm -rf "$LOCAL/jdk.tmp" && mkdir -p "$LOCAL/jdk.tmp"
  tar -xzf "$LOCAL/downloads/$JDK_TGZ" -C "$LOCAL/jdk.tmp"
  HOME_DIR="$(find "$LOCAL/jdk.tmp" -maxdepth 4 -type d -name Home | head -1)"
  [ -z "$HOME_DIR" ] && HOME_DIR="$(find "$LOCAL/jdk.tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
  mv "$HOME_DIR" "$LOCAL/jdk"
  rm -rf "$LOCAL/jdk.tmp"
elif command -v java >/dev/null && java -version >/dev/null 2>&1; then
  echo "No pinned JDK for $OS-$ARCH; using java on PATH"
else
  echo "No pinned JDK for $OS-$ARCH and no java on PATH. Install JDK 17+ and rerun." >&2
  exit 1
fi

if [ -x "$LOCAL/kafka/bin/kafka-server-start.sh" ]; then
  echo "Kafka already present at .local/kafka"
else
  echo "Downloading $KAFKA_TGZ"
  curl -fsSL --retry 3 -o "$LOCAL/downloads/$KAFKA_TGZ" "$KAFKA_URL"
  echo "$KAFKA_SHA512  $LOCAL/downloads/$KAFKA_TGZ" | shasum -a 512 -c -
  rm -rf "$LOCAL/kafka" && mkdir -p "$LOCAL/kafka"
  tar -xzf "$LOCAL/downloads/$KAFKA_TGZ" -C "$LOCAL/kafka" --strip-components 1
fi

"$LOCAL/jdk/bin/java" -version 2>&1 | head -1 || true
echo "Kafka $KAFKA_VERSION ready in .local/kafka"
