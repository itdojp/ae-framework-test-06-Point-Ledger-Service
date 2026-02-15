# Persistence Backward Compatibility Policy

## 1. 対象
- Point Ledger Service の永続化状態（`LedgerPersistentState`）
- 保存先: file backend / PostgreSQL backend 共通

## 2. 現行スキーマ
- 現行 `schemaVersion`: `1`
- 出力元: `LedgerService.exportState()`

## 3. 読込互換ポリシー
1. `schemaVersion=1`
- そのまま読込を許可する。

2. `schemaVersion` なし（legacy snapshot）
- `LedgerSnapshot` 形式を `schemaVersion=1` とみなして読込を許可する。
- 目的: 初期実装時点のスナップショット互換を維持するため。

3. `schemaVersion` が 1 以外
- 読込を拒否する。
- エラー: `STATE_SCHEMA_UNSUPPORTED`

## 4. 将来バージョン移行ルール
- `schemaVersion=2` を導入する場合は、`v1 -> v2` の明示的マイグレーションを実装する。
- 互換読込時は破壊的変換を避け、変換根拠を `docs/plans/` に記録する。
- 変換実装時は以下を必須とする。
  - 正常系テスト（旧版入力からの移行成功）
  - 異常系テスト（未対応版で拒否）
  - `artifacts/runs/<ts>/` に検証ログ保存
