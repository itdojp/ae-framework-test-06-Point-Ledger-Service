# Phase 2 Progress (2026-02-15)

## 実施内容
- 永続化対応
  - `LedgerService` に `StateStore` 抽象を導入
  - `LEDGER_STATE_BACKEND=file|postgres` でストア切替
  - `src/persistence/file-state-store.ts`
  - `src/persistence/postgres-state-store.ts`
  - `LEDGER_STATE_FILE` または `LEDGER_DATABASE_URL` 指定で起動時ロード、更新時オートセーブ
  - 復元時に idempotency/reversal インデックスを再構成
  - schemaVersion なし旧スナップショットを互換読込（v1扱い）
  - 互換方針文書: `docs/specs/PERSISTENCE-BACKWARD-COMPAT-POLICY.md`
  - PostgreSQL E2E スモークテストを追加: `tests/e2e/postgres-state-store.e2e.test.ts`
  - 実行コマンドを追加: `pnpm run test:e2e:postgres`
  - CI自動化: `.github/workflows/postgres-e2e.yml` で PostgreSQL service container 実行
- 監査ログ参照API追加
  - `GET /api/v1/audit-logs`
  - `ADMIN` のみ参照可能
  - ページング・ソート対応（page/pageSize/order）
  - 検索条件拡張（targetId）
- 取引参照API拡張
  - `GET /api/v1/transactions` にページング・ソート対応（page/pageSize/order）
- 運用メトリクスAPI追加
  - `GET /api/v1/metrics`
  - `ADMIN` のみ参照可能
  - account/transaction/lot/audit の件数メトリクスを返却
- 読取系レート制御追加（任意）
  - 対象: `GET /api/v1/transactions`, `GET /api/v1/audit-logs`, `GET /api/v1/metrics`
  - 設定: `LEDGER_READ_RATE_LIMIT_WINDOW_MS`, `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS`
  - scope別上限: `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_TRANSACTIONS|AUDIT_LOGS|METRICS`
  - role別上限: `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_ADMIN|MEMBER|VIEWER`
  - actorキー戦略: `LEDGER_READ_RATE_LIMIT_ACTOR_KEY_STRATEGY` (`ip|role_ip|user|role_user`)
  - 応答ヘッダ: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - 超過時ヘッダ: `Retry-After`
  - `GET /api/v1/metrics` に runtime counters（scope別 allowed/blocked）を追加
  - 超過時: HTTP 429 (`RATE_LIMIT_EXCEEDED`)
- 自動化強化
  - `scripts/ae/phase2-run.sh` を追加
  - `scripts/acceptance/run-and-report.sh` を追加
  - `scripts/acceptance/generate-lgacc-summary.mjs` を追加
  - 受入テスト JSON と LG-ACC 判定サマリを artifacts に保存可能

## テスト
- 単体: 永続化ラウンドトリップ + 旧スナップショット互換読込テストを追加
- API: 監査ログフィルタ、transactionsページング、metrics権限制御、読取レート制御（scope別/role別上限、actor戦略、ヘッダ、runtime counters）テストを追加

## 現在の検証結果
- `pnpm run typecheck`: pass
- `pnpm run test`: pass (29 passed, 1 skipped)
- `scripts/ae/phase2-run.sh`: pass
  - `artifacts/runs/20260215T215216Z/phase2-summary.json`
  - `artifacts/runs/20260215T215216Z/acceptance-vitest.json`
  - `artifacts/runs/20260215T215216Z/acceptance-lgacc-summary.json`

## 次の継続項目
- PostgreSQL E2E の定期実行結果レビュー（flake検知、再試行ポリシー）
- レート制御の運用チューニング（分散環境での共有化、TTL戦略）
