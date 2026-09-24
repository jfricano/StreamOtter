#!/usr/bin/env bash
# Downloads a pinned, checksum-verified Caddy into .local/caddy for the proxied deployment check.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
VERSION="2.11.4"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM="mac_arm64" ;;
  Darwin-x86_64) PLATFORM="mac_amd64" ;;
  Linux-x86_64) PLATFORM="linux_amd64" ;;
  Linux-aarch64) PLATFORM="linux_arm64" ;;
  *) echo "Unsupported platform for this script; install Caddy $VERSION and put it at .local/caddy/caddy" >&2; exit 1 ;;
esac
FILE="caddy_${VERSION}_${PLATFORM}.tar.gz"
BASE="https://github.com/caddyserver/caddy/releases/download/v${VERSION}"
if [ -x "$LOCAL/caddy/caddy" ]; then echo "Caddy already present at .local/caddy"; exit 0; fi
mkdir -p "$LOCAL/downloads" "$LOCAL/caddy"
curl -fsSL --retry 3 -o "$LOCAL/downloads/$FILE" "$BASE/$FILE"
curl -fsSL --retry 3 "$BASE/caddy_${VERSION}_checksums.txt" | grep " $FILE\$" > "$LOCAL/downloads/$FILE.sha512"
(cd "$LOCAL/downloads" && shasum -a 512 -c "$FILE.sha512")
tar -xzf "$LOCAL/downloads/$FILE" -C "$LOCAL/caddy" caddy
"$LOCAL/caddy/caddy" version
