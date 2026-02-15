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
- 自動化強化
  - `scripts/ae/phase2-run.sh` を追加
  - `scripts/acceptance/run-and-report.sh` を追加
  - `scripts/acceptance/generate-lgacc-summary.mjs` を追加
  - 受入テスト JSON と LG-ACC 判定サマリを artifacts に保存可能

## テスト
- 単体: 永続化ラウンドトリップ + 旧スナップショット互換読込テストを追加
- API: 監査ログフィルタ、transactionsページング、metrics権限制御テストを追加

## 現在の検証結果
- `pnpm run typecheck`: pass
- `pnpm run test`: pass (24 passed, 1 skipped)
- `scripts/ae/phase2-run.sh`: pass
  - `artifacts/runs/20260215T141833Z/phase2-summary.json`
  - `artifacts/runs/20260215T141833Z/acceptance-vitest.json`
  - `artifacts/runs/20260215T141833Z/acceptance-lgacc-summary.json`

## 次の継続項目
- PostgreSQL 実行環境（Docker等）での接続E2E実行と結果保存
- 監査ログ/取引APIの運用上限設計（最大pageSize, レート制御）
