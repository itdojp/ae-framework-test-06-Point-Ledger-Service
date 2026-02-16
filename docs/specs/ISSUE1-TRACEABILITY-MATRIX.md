# Issue #1 Traceability Matrix

最終更新日: 2026-02-16  
対象仕様: [Issue #1](https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/1)  
基準コミット: `19bc985`

## 1. 不変条件（LG-INV-*）

| 要件ID | 検証状態 | 主な証跡 |
| --- | --- | --- |
| LG-INV-001 | Covered | `tests/property/invariants.property.test.ts`（tx合計0） |
| LG-INV-002 | Covered | `tests/mbt/ledger.mbt.test.ts`（モデル残高一致） |
| LG-INV-003 | Covered | `tests/property/invariants.property.test.ts`（非負残高） |
| LG-INV-004 | Covered | `tests/unit/ledger-service.test.ts`（FEFO消費/取消/失効） |
| LG-INV-005 | Covered | `tests/unit/ledger-service.test.ts`（active lot合計と残高一致） |
| LG-INV-006 | Covered | `tests/acceptance/ledger.acceptance.test.ts`, `tests/api/http-api.test.ts`（失効後lot） |
| LG-INV-007 | Covered | `tests/unit/ledger-service.test.ts`（reversal符号反転ミラー） |

## 2. 業務ルール（LG-RULE-*/LG-TX-*/LG-EXP-*）

| 要件ID | 検証状態 | 主な証跡 |
| --- | --- | --- |
| LG-RULE-ACC-001 | Covered | `tests/api/http-api.test.ts`（SYSTEM口座重複409） |
| LG-RULE-REV-001 | Covered | `tests/unit/ledger-service.test.ts`（EARN未消費のみ取消可） |
| LG-RULE-REV-002 | Covered | `tests/unit/ledger-service.test.ts`, `tests/api/http-api.test.ts`（SPEND取消で復元） |
| LG-RULE-REV-003 | Covered | `tests/api/http-api.test.ts`（EXPIRE取消不可） |
| LG-TX-001 | Covered | `tests/api/http-api.test.ts`（ADJUST+expiresAtでlot生成） |
| LG-TX-002 | Covered | `tests/unit/ledger-service.test.ts`, `tests/api/http-api.test.ts`（FEFO割当） |
| LG-TX-003 | Covered | `tests/api/http-api.test.ts`（sum不一致400） |
| LG-TX-004 | Covered | `tests/api/http-api.test.ts`, `tests/unit/ledger-service.test.ts`（idempotency再送同一結果） |
| LG-EXP-001 | Covered | `tests/api/http-api.test.ts`（失効バッチ二重実行で再失効なし） |

## 3. 認可・競合・受入

| 要件ID | 検証状態 | 主な証跡 |
| --- | --- | --- |
| LG-CC-001 | Covered | `tests/acceptance/ledger.acceptance.test.ts`, `tests/unit/ledger-service.test.ts`（同時SPEND過剰消費防止） |
| LG-AUTH-001 | Covered | `tests/api/http-api.test.ts`（tenant不一致404） |
| LG-AUTH-002 | Covered | `tests/api/http-api.test.ts`（他人口座SPEND禁止403） |
| LG-ACC-01 | Covered | `tests/acceptance/ledger.acceptance.test.ts` |
| LG-ACC-02 | Covered | `tests/acceptance/ledger.acceptance.test.ts` |
| LG-ACC-03 | Covered | `tests/acceptance/ledger.acceptance.test.ts` |
| LG-ACC-04 | Covered | `tests/acceptance/ledger.acceptance.test.ts` |

## 4. 自動化証跡

- 実装・テスト・ae-framework 実行証跡は `artifacts/runs/<timestamp>/` に保存
- ローカル包括実行: `scripts/ae/phase2-run.sh`
- CI自動検証:
  - `.github/workflows/ae-framework-evaluation.yml`
  - `.github/workflows/postgres-e2e.yml`
