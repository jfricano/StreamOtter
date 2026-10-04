#!/usr/bin/env bash
# Downloads a pinned, checksum-verified Caddy into .local/caddy for the proxied deployment check.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
VERSION="2.11.4"
# SHA-512 values from the official caddy_${VERSION}_checksums.txt for this release, pinned here so a
# tampered release asset and checksums file can't vouch for each other.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM="mac_arm64"
    SHA512="3190ae0df98b59ab4b6021556fa35adc3c526a4f3e138776b0eaec8a037cc26121cbbb1ad53453f565551b47d37d5ba4755e2c2c3652256737fe2ce9e53c8ec0" ;;
  Darwin-x86_64) PLATFORM="mac_amd64"
    SHA512="e04eb10f9ce7e2e079bc9bff1bd5d3a3164888d1edbb1a49e5d15be4eab691b57e89ed36bb29c65ba43f1ba8d9279e0967b1003991c13fe4cb78384c3caf25de" ;;
  Linux-x86_64) PLATFORM="linux_amd64"
    SHA512="8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9" ;;
  Linux-aarch64|Linux-arm64) PLATFORM="linux_arm64"
    SHA512="d5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c" ;;
  *) echo "Unsupported platform for this script; install Caddy $VERSION and put it at .local/caddy/caddy" >&2; exit 1 ;;
esac
FILE="caddy_${VERSION}_${PLATFORM}.tar.gz"
BASE="https://github.com/caddyserver/caddy/releases/download/v${VERSION}"
if [ -x "$LOCAL/caddy/caddy" ]; then echo "Caddy already present at .local/caddy"; exit 0; fi
mkdir -p "$LOCAL/downloads" "$LOCAL/caddy"
curl -fsSL --retry 3 -o "$LOCAL/downloads/$FILE" "$BASE/$FILE"
echo "$SHA512  $LOCAL/downloads/$FILE" | shasum -a 512 -c -
tar -xzf "$LOCAL/downloads/$FILE" -C "$LOCAL/caddy" caddy
"$LOCAL/caddy/caddy" version
