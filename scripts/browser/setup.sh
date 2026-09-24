#!/usr/bin/env bash
# Installs Playwright's headless Chromium into .local/ms-playwright for `pnpm test:browser`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/tests"
PLAYWRIGHT_BROWSERS_PATH="$ROOT/.local/ms-playwright" node node_modules/playwright/cli.js install --only-shell chromium
