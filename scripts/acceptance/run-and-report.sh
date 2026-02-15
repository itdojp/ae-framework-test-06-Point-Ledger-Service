#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_PATH="${1:-$PROJECT_ROOT/artifacts/acceptance/latest/acceptance-vitest.json}"
mkdir -p "$(dirname "$REPORT_PATH")"

pnpm --dir "$PROJECT_ROOT" exec vitest run tests/acceptance --reporter=json --outputFile "$REPORT_PATH"
