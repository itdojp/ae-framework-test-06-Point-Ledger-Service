# Initial Development Plan

## 1. 目的
Issue #1 の Point Ledger Service 仕様を、ae-framework を用いて仕様駆動かつ検証可能な形で実装する。

## 2. 前提
- 日付基準: 2026-02-15 開始
- 仕様ソース: Issue #1
- 実行環境基準: Issue #2（codex-cli 0.101.0 / GPT-5 系）
- ツール利用仕様: `docs/specs/AE-FRAMEWORK-UTILIZATION-SPEC.md`

## 3. フェーズ計画
1. Phase 0: 立ち上げ（2026-02-15〜2026-02-16）
- AE-Spec 初版作成
- `ae spec validate/lint/export` の自動化
- 成果物保存ルールを確定

2. Phase 1: ドメインとAPIの骨格実装（2026-02-16〜2026-02-19）
- Account / LedgerTransaction / LedgerEntry / PointLot のモデル実装
- APIの雛形（accounts, transactions, reverse, lots）
- 単体テストと最小統合テスト

3. Phase 2: 主要業務ロジック実装（2026-02-19〜2026-02-23）
- EARN / SPEND / ADJUST / REVERSAL / EXPIRE
- FEFO 消費割当
- idempotency_key 処理

4. Phase 3: 競合制御・整合性保証（2026-02-23〜2026-02-26）
- 同時SPENDの過剰消費防止
- 不変条件 LG-INV-* の実装反映
- 失効バッチと監査ログ

5. Phase 4: 検証強化と受入れ（2026-02-26〜2026-03-01）
- Property / MBT / mutation の整備
- `verify-lite` と CI ゲート固定
- 受入基準 LG-ACC-01〜04 の確認

## 4. 成果物
- 仕様: `spec/`, `.ae/ae-ir.json`
- 実装: `src/`
- テスト: `tests/`
- 評価証跡: `artifacts/runs/`, `artifacts/bootstrap/`

## 5. 完了条件
- Issue #1 の受入基準を満たす
- ae-framework 実行結果が再現可能
- 中間生成物を GitHub 上で追跡可能
