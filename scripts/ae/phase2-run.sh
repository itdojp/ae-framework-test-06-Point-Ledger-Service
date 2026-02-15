#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AE_FRAMEWORK_DIR="${AE_FRAMEWORK_DIR:-$PROJECT_ROOT/../ae-framework}"
RUN_TS="${RUN_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="$PROJECT_ROOT/artifacts/runs/$RUN_TS"
STATE_FILE_PATH="${STATE_FILE_PATH:-$PROJECT_ROOT/artifacts/state/ledger-state.json}"

mkdir -p "$RUN_DIR" "$PROJECT_ROOT/artifacts/state"

pnpm --dir "$PROJECT_ROOT" run typecheck > "$RUN_DIR/typecheck.log" 2>&1
pnpm --dir "$PROJECT_ROOT" run test > "$RUN_DIR/test.log" 2>&1
pnpm --dir "$PROJECT_ROOT" run build > "$RUN_DIR/build.log" 2>&1

"$PROJECT_ROOT/scripts/acceptance/run-and-report.sh" "$RUN_DIR/acceptance-vitest.json" > "$RUN_DIR/acceptance.log" 2>&1

AE_FRAMEWORK_DIR="$AE_FRAMEWORK_DIR" RUN_TS="$RUN_TS" "$PROJECT_ROOT/scripts/ae/evaluation-run.sh" > "$RUN_DIR/ae-evaluation.log" 2>&1

set +e
pnpm --dir "$AE_FRAMEWORK_DIR" run ae-framework validate --traceability --sources "$PROJECT_ROOT/spec,$PROJECT_ROOT/src,$PROJECT_ROOT/tests" > "$RUN_DIR/ae-traceability.log" 2>&1
traceability_exit=$?
pnpm --dir "$AE_FRAMEWORK_DIR" run ae-framework user-stories --generate --sources "$PROJECT_ROOT/spec/point-ledger-service.ae.md" > "$RUN_DIR/ae-user-stories.log" 2>&1
user_stories_exit=$?
set -e

if [ -f "$STATE_FILE_PATH" ]; then
  cp "$STATE_FILE_PATH" "$RUN_DIR/ledger-state.snapshot.json"
fi

cat > "$RUN_DIR/phase2-summary.json" <<JSON
{
  "runTimestampUtc": "$RUN_TS",
  "checks": [
    "pnpm run typecheck",
    "pnpm run test",
    "pnpm run build",
    "scripts/acceptance/run-and-report.sh",
    "scripts/ae/evaluation-run.sh",
    "ae validate --traceability",
    "ae user-stories --generate"
  ],
  "stateFilePath": "$STATE_FILE_PATH",
  "aeExtended": {
    "traceabilityExitCode": $traceability_exit,
    "userStoriesExitCode": $user_stories_exit
  },
  "status": "success"
}
JSON

echo "Phase2 run completed: $RUN_DIR"
