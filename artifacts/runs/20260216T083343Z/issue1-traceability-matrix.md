# Issue #1 Traceability Matrix

対象仕様: [Issue #1](https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/1)  

## 1. Invariants (LG-INV-*)

| 要件ID | 検証状態 | 主な証跡 | 備考 |
| --- | --- | --- | --- |
| LG-INV-001 | Covered | `tests/property/invariants.property.test.ts` | transaction sum == 0 |
| LG-INV-002 | Covered | `tests/mbt/ledger.mbt.test.ts` | model balance consistency |
| LG-INV-003 | Covered | `tests/property/invariants.property.test.ts` | non-negative balance |
| LG-INV-004 | Covered | `tests/unit/ledger-service.test.ts` | lot remaining amount range |
| LG-INV-005 | Covered | `tests/unit/ledger-service.test.ts` | sum(active lot remaining) == user balance |
| LG-INV-006 | Covered | `tests/acceptance/ledger.acceptance.test.ts`, `tests/api/http-api.test.ts` | expired lots do not contribute to balance |
| LG-INV-007 | Covered | `tests/unit/ledger-service.test.ts` | reversal entries are sign-inverted mirror |

## 2. Business Rules (LG-RULE-*/LG-TX-*/LG-EXP-*)

| 要件ID | 検証状態 | 主な証跡 | 備考 |
| --- | --- | --- | --- |
| LG-RULE-ACC-001 | Covered | `tests/api/http-api.test.ts` | duplicate SYSTEM account returns 409 |
| LG-RULE-REV-001 | Covered | `tests/unit/ledger-service.test.ts` | EARN reversal allowed only when unconsumed |
| LG-RULE-REV-002 | Covered | `tests/unit/ledger-service.test.ts`, `tests/api/http-api.test.ts` | SPEND reversal restores lot consumption |
| LG-RULE-REV-003 | Covered | `tests/api/http-api.test.ts` | EXPIRE reversal is not allowed |
| LG-TX-001 | Covered | `tests/api/http-api.test.ts` | lot is created when ADJUST/EARN entry has expiresAt |
| LG-TX-002 | Covered | `tests/unit/ledger-service.test.ts`, `tests/api/http-api.test.ts` | SPEND generates FEFO consumptions |
| LG-TX-003 | Covered | `tests/api/http-api.test.ts` | sum mismatch returns 400 |
| LG-TX-004 | Covered | `tests/api/http-api.test.ts`, `tests/unit/ledger-service.test.ts` | idempotency resend returns same result |
| LG-EXP-001 | Covered | `tests/api/http-api.test.ts` | expiration batch is idempotent per lot |

## 3. Auth, Concurrency, Acceptance

| 要件ID | 検証状態 | 主な証跡 | 備考 |
| --- | --- | --- | --- |
| LG-CC-001 | Covered | `tests/acceptance/ledger.acceptance.test.ts`, `tests/unit/ledger-service.test.ts` | concurrent spend does not over-consume |
| LG-AUTH-001 | Covered | `tests/api/http-api.test.ts` | tenant mismatch returns 404 |
| LG-AUTH-002 | Covered | `tests/api/http-api.test.ts` | spend on another user's account is forbidden |
| LG-ACC-01 | Covered | `tests/acceptance/ledger.acceptance.test.ts` | acceptance criterion |
| LG-ACC-02 | Covered | `tests/acceptance/ledger.acceptance.test.ts` | acceptance criterion |
| LG-ACC-03 | Covered | `tests/acceptance/ledger.acceptance.test.ts` | acceptance criterion |
| LG-ACC-04 | Covered | `tests/acceptance/ledger.acceptance.test.ts` | acceptance criterion |

## 4. 自動化証跡

- 実装・テスト・ae-framework 実行証跡は `artifacts/runs/<timestamp>/` に保存
- トレーサビリティ定義ソース: `docs/specs/issue1-traceability-map.json`
- `scripts/ae/phase2-run.sh`
- `.github/workflows/ae-framework-evaluation.yml`
- `.github/workflows/postgres-e2e.yml`

<!-- generated: scripts/traceability/generate-issue1-traceability-matrix.mjs -->
