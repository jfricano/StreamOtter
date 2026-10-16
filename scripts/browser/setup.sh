#!/usr/bin/env bash
# Installs Playwright's browsers into .local/ms-playwright for `pnpm test:browser`.
# Engines: the arguments (chromium, firefox, webkit, or all), else STREAMOTTER_BROWSER, else chromium.
# Chromium is the headless shell. System libraries are separate: on Linux, run
# `node tests/node_modules/playwright/cli.js install-deps <engine>` with root privileges.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$#" -eq 0 ]; then set -- "${STREAMOTTER_BROWSER:-chromium}"; fi
if [ "$*" = "all" ]; then set -- chromium firefox webkit; fi
cd "$ROOT/tests"
for engine in "$@"; do
  case "$engine" in
    chromium) args=(--only-shell chromium) ;;
    firefox | webkit) args=("$engine") ;;
    *) echo "Unknown browser engine \"$engine\": use chromium, firefox, webkit, or all." >&2; exit 2 ;;
  esac
  PLAYWRIGHT_BROWSERS_PATH="$ROOT/.local/ms-playwright" node node_modules/playwright/cli.js install "${args[@]}"
done
