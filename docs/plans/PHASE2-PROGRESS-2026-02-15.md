# Phase 2 Progress (2026-02-15)

## 実施内容
- 永続化対応
  - `LedgerService` に JSON 状態保存/復元を追加
  - `LEDGER_STATE_FILE` 指定時に起動時ロード、更新時オートセーブ
  - 復元時に idempotency/reversal インデックスを再構成
- 監査ログ参照API追加
  - `GET /api/v1/audit-logs`
  - `ADMIN` のみ参照可能
- 自動化強化
  - `scripts/ae/phase2-run.sh` を追加
  - `scripts/acceptance/run-and-report.sh` を追加
  - 受入テスト JSON レポートを artifacts に保存可能

## テスト
- 単体: 永続化ラウンドトリップテストを追加
- API: 監査ログ参照と権限制御テストを追加

## 現在の検証結果
- `pnpm run typecheck`: pass
- `pnpm run test`: pass (20 tests)
- `scripts/ae/phase2-run.sh`: pass
  - `artifacts/runs/20260215T132819Z/phase2-summary.json`
  - `artifacts/runs/20260215T132819Z/acceptance-vitest.json`

## 次の継続項目
- 永続化フォーマットの後方互換ポリシー
- DBバックエンド（PostgreSQL等）への差し替え準備
- 監査ログAPIの検索条件拡張とページング
