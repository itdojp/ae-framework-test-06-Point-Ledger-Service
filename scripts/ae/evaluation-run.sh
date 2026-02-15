#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AE_FRAMEWORK_DIR="${AE_FRAMEWORK_DIR:-$PROJECT_ROOT/../ae-framework}"
RUN_TS="${RUN_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="$PROJECT_ROOT/artifacts/runs/$RUN_TS"
SPEC_FILE="$PROJECT_ROOT/spec/point-ledger-service.ae.md"
AE_IR_FILE="$PROJECT_ROOT/.ae/ae-ir.json"
AE_IR_HASH_FILE="$PROJECT_ROOT/.ae/ae-ir.sha256"
KIRO_DIR="$PROJECT_ROOT/.kiro/specs"

mkdir -p "$PROJECT_ROOT/.ae" "$KIRO_DIR" "$RUN_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm が見つかりません" >&2
  exit 1
fi

if [ ! -d "$AE_FRAMEWORK_DIR" ]; then
  echo "AE_FRAMEWORK_DIR が存在しません: $AE_FRAMEWORK_DIR" >&2
  exit 1
fi

if [ ! -f "$SPEC_FILE" ]; then
  echo "spec ファイルが存在しません: $SPEC_FILE" >&2
  exit 1
fi

if [ ! -d "$AE_FRAMEWORK_DIR/node_modules" ]; then
  pnpm --dir "$AE_FRAMEWORK_DIR" install --frozen-lockfile
fi

pnpm --dir "$AE_FRAMEWORK_DIR" run ae-framework spec validate -i "$SPEC_FILE" --output "$AE_IR_FILE"
pnpm --dir "$AE_FRAMEWORK_DIR" run ae-framework spec lint -i "$AE_IR_FILE"
pnpm --dir "$AE_FRAMEWORK_DIR" run ae-framework spec export -i "$AE_IR_FILE" -f kiro -o "$KIRO_DIR"

sha256sum "$AE_IR_FILE" > "$AE_IR_HASH_FILE"
cp "$AE_IR_FILE" "$RUN_DIR/ae-ir.json"
cp "$AE_IR_HASH_FILE" "$RUN_DIR/ae-ir.sha256"

cat > "$RUN_DIR/summary.json" <<JSON
{
  "runTimestampUtc": "$RUN_TS",
  "aeFrameworkDir": "$AE_FRAMEWORK_DIR",
  "specFile": "spec/point-ledger-service.ae.md",
  "commands": [
    "ae spec validate",
    "ae spec lint",
    "ae spec export -f kiro"
  ],
  "outputs": [
    ".ae/ae-ir.json",
    ".ae/ae-ir.sha256",
    ".kiro/specs"
  ],
  "status": "success"
}
JSON

echo "Evaluation completed: $RUN_DIR"
