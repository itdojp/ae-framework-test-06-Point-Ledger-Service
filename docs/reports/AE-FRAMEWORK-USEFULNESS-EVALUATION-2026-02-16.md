# ae-framework 有用性評価 (2026-02-16)

## 1. 評価目的
本開発（Issue #1 実装）を通じて、`itdojp/ae-framework` の実運用有用性を評価する。

## 2. 評価対象機能
- `ae spec validate / lint / export`
- `ae validate --traceability`
- `ae user-stories --generate`
- ローカル自動化: `scripts/ae/evaluation-run.sh`, `scripts/ae/phase2-run.sh`
- CI自動化:
  - `.github/workflows/ae-framework-evaluation.yml`
  - `.github/workflows/postgres-e2e.yml`

## 3. 観測結果
### 3.1 仕様品質向上
- `ae spec lint` が `BIZ_001` warning（Business Rules不足）を検知。
- 対応後、`spec lint` warnings は `0` に改善。
- 根拠:
  - 改善後 run: `artifacts/runs/20260216T082714Z/ae-evaluation.log`
  - 継続確認 run: `artifacts/runs/20260216T083343Z/ae-evaluation.log`

### 3.2 トレーサビリティ強化
- Issue #1 の `LG-*` 要件を機械可読マップ化し、Markdownを自動生成。
- `phase2-run` に統合し、毎回 `issue1-traceability-matrix.md` を生成・保存。
- 根拠:
  - 定義: `docs/specs/issue1-traceability-map.json`
  - 生成器: `scripts/traceability/generate-issue1-traceability-matrix.mjs`
  - 出力例: `artifacts/runs/20260216T083343Z/issue1-traceability-matrix.md`

### 3.3 再現性・監査性
- 各 run を `artifacts/runs/<timestamp>/` に保存し、GitHubへ自動コミット。
- CI実行結果と証跡が1対1で追跡可能。
- 根拠:
  - `postgres-e2e` run: `22055569983`（success）
  - `ae-framework-evaluation` run: `22055569947`（success）
  - 対応 artifacts:
    - `artifacts/runs/20260216T083545Z/`
    - `artifacts/runs/20260216T083551Z/`

### 3.4 運用品質（CIゲート）
- trend/gateを直近完了runベースに改善し、実データ上の信頼性判定を安定化。
- 最新 gate 判定は `pass`（`mode: recent:10`, `successRate: 1`）。
- 根拠:
  - `artifacts/runs/20260216T083545Z/postgres-e2e-gate.json`

## 4. 有用性評価（結論）
- **総合評価: 有用（採用継続を推奨）**
- 理由:
  1. 仕様欠陥の早期検知（lint warning）
  2. 要件-実装-検証の追跡可能性を自動化
  3. 実行証跡の再現性・監査性を標準化
  4. CIと連動した継続評価が成立

## 5. 制約・課題
- 初期セットアップ時は仕様整形と運用ルール整備のコストが発生。
- trend/gate は履歴品質に依存するため、判定母集団の設計（window / recent）が必要。

## 6. 今後の推奨
1. `issue1-traceability-map.json` をレビュー運用に正式組み込み、要件変更時の更新責任を明確化。
2. `ae validate --traceability` の結果を fail条件へ段階的に昇格（現状はログ保存中心）。
3. 同様のマトリクス生成を Issue #2 以降にも展開し、仕様変更の差分監査を標準化。
