# Point Ledger Service (ae-framework Evaluation)

`itdojp/ae-framework` を用いて Point Ledger Service を仕様駆動で開発し、有用性を検証するためのリポジトリです。

## 起点 Issue
- 仕様: `Issue #1` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/1
- 開発開始時環境記録: `Issue #2` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/2
- 開発計画: `Issue #3` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/3

## 参照ドキュメント
- 開発計画: `docs/plans/INITIAL-DEVELOPMENT-PLAN.md`
- ae-framework利用仕様: `docs/specs/AE-FRAMEWORK-UTILIZATION-SPEC.md`
- 永続化後方互換ポリシー: `docs/specs/PERSISTENCE-BACKWARD-COMPAT-POLICY.md`
- 初期AE-Spec: `spec/point-ledger-service.ae.md`

## 自動実行（ローカル）
```bash
AE_FRAMEWORK_DIR=../ae-framework ./scripts/ae/evaluation-run.sh
```

Phase 1 実装と評価を一括で実行する場合:
```bash
AE_FRAMEWORK_DIR=../ae-framework ./scripts/ae/phase1-run.sh
```

Phase 2 実装（build/acceptance report含む）を一括実行する場合:
```bash
AE_FRAMEWORK_DIR=../ae-framework ./scripts/ae/phase2-run.sh
```

GitHub Actions で PostgreSQL E2E を実行する場合:
- Workflow: `.github/workflows/postgres-e2e.yml`
- 出力: `artifacts/runs/<RUN_TS>/postgres-e2e-*.json|log`

永続化を有効化してサーバ起動する場合:
```bash
LEDGER_STATE_FILE=./artifacts/state/ledger-state.json pnpm run start
```

PostgreSQL 永続化で起動する場合:
```bash
LEDGER_STATE_BACKEND=postgres \
LEDGER_DATABASE_URL=postgres://user:pass@localhost:5432/point_ledger \
LEDGER_STATE_KEY=point-ledger-service \
pnpm run start
```

PostgreSQL 永続化のE2Eスモークテストを実行する場合:
```bash
LEDGER_DATABASE_URL=postgres://user:pass@localhost:5432/point_ledger \
pnpm run test:e2e:postgres
```
`pnpm run test` では `LEDGER_DATABASE_URL` 未設定時に E2E ケースは skip される。

受入基準サマリを生成する場合:
```bash
node scripts/acceptance/generate-lgacc-summary.mjs \
  artifacts/runs/<RUN_TS>/acceptance-vitest.json \
  artifacts/runs/<RUN_TS>/acceptance-lgacc-summary.json
```

## API補足
- `GET /api/v1/transactions`
  - クエリ: `tenantId`(必須), `accountId`, `txType`, `externalRef`, `postedFrom`, `postedTo`, `page`, `pageSize`, `order`
- `GET /api/v1/audit-logs`
  - クエリ: `tenantId`(必須), `action`, `targetType`, `targetId`, `actorUserId`, `from`, `to`, `page`, `pageSize`, `order`
  - 応答: `page`, `pageSize`, `total`, `items`
- `GET /api/v1/metrics`
  - クエリ: `tenantId`(必須)
  - 権限: `ADMIN` のみ
  - 応答: account/transaction/lot/audit の件数メトリクス
- 読取系レート制御（任意）
  - 対象: `GET /api/v1/transactions`, `GET /api/v1/audit-logs`, `GET /api/v1/metrics`
  - `LEDGER_READ_RATE_LIMIT_WINDOW_MS` と `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS` を正の整数で同時指定すると有効
  - scope別上限を上書きする場合:
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_TRANSACTIONS`
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_AUDIT_LOGS`
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_METRICS`
  - role別上限を上書きする場合:
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_ADMIN`
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_MEMBER`
    - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_VIEWER`
  - actorキー戦略:
    - `LEDGER_READ_RATE_LIMIT_ACTOR_KEY_STRATEGY` (`ip` | `role_ip` | `user` | `role_user`)
  - 応答ヘッダ: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - 超過時は `429` (`RATE_LIMIT_EXCEEDED`) を返却
  - `GET /api/v1/metrics` には runtime レート制御カウンタ（allowed/blocked）を含む

## 中間生成物の保存方針
- `artifacts/`、`.ae/`、`.kiro/` を Git 管理対象にする。
- ae-framework 実行で得られた生成物は、評価証跡としてコミット対象にする。
