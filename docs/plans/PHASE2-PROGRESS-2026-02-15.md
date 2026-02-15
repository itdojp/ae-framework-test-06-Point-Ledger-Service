# Phase 2 Progress (2026-02-15)

## 実施内容
- 永続化対応
  - `LedgerService` に `StateStore` 抽象を導入
  - `LEDGER_STATE_BACKEND=file|postgres` でストア切替
  - `src/persistence/file-state-store.ts`
  - `src/persistence/postgres-state-store.ts`
  - `LEDGER_STATE_FILE` または `LEDGER_DATABASE_URL` 指定で起動時ロード、更新時オートセーブ
  - 復元時に idempotency/reversal インデックスを再構成
- 監査ログ参照API追加
  - `GET /api/v1/audit-logs`
  - `ADMIN` のみ参照可能
- 自動化強化
  - `scripts/ae/phase2-run.sh` を追加
  - `scripts/acceptance/run-and-report.sh` を追加
  - `scripts/acceptance/generate-lgacc-summary.mjs` を追加
  - 受入テスト JSON と LG-ACC 判定サマリを artifacts に保存可能

## テスト
- 単体: 永続化ラウンドトリップテストを追加
- API: 監査ログ参照と権限制御テストを追加

## 現在の検証結果
- `pnpm run typecheck`: pass
- `pnpm run test`: pass (21 tests)
- `scripts/ae/phase2-run.sh`: pass
  - `artifacts/runs/20260215T140450Z/phase2-summary.json`
  - `artifacts/runs/20260215T140450Z/acceptance-vitest.json`
  - `artifacts/runs/20260215T140450Z/acceptance-lgacc-summary.json`

## 次の継続項目
- 永続化フォーマットの後方互換ポリシー
- PostgreSQL 実行環境での接続E2E検証
- 監査ログAPIの検索条件拡張とページング
