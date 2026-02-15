# AE-Framework Utilization Specification

## 1. 目的
Point Ledger Service 開発で利用する ae-framework ツールと自動化方式を定義し、実行時の参照仕様とする。

## 2. 前提条件（根拠付き）
- Node.js: `>=20.11 <23`
- pnpm: `10.x`
- 根拠: `itdojp/ae-framework` の `package.json` (`engines.node`, `packageManager`)

## 3. 採用ツール
1. `ae spec validate`
- 用途: AE-Spec(Markdown) を AE-IR(JSON)へ変換し、構造整合を検証
- 出力: `.ae/ae-ir.json`

2. `ae spec lint`
- 用途: AE-IRの整合性検査
- 出力: 標準出力 + `artifacts/runs/<ts>/summary.json` に記録

3. `ae spec export -f kiro`
- 用途: 仕様参照用の機械可読エクスポート
- 出力: `.kiro/specs/`

4. `ae validate --traceability`（Phase 1以降）
- 用途: 仕様・実装・テストの追跡可能性検証
- 出力: `artifacts/runs/<ts>/traceability.*`

5. `ae conformance verify/report`（Phase 2以降）
- 用途: 実行時ルール適合性の検証
- 出力: `artifacts/hermetic-reports/conformance/`

6. `test:property` / `test:mbt` / `pipelines:mutation:quick`（Phase 3以降）
- 用途: 不変条件・状態遷移・退行耐性の検証
- 出力: `artifacts/properties/`, `artifacts/mbt/`, `reports/` 等

## 4. 自動化方針（可能な限り自動化）
1. ローカル自動化
- スクリプト: `scripts/ae/evaluation-run.sh`
- 実施内容: validate → lint → export → ハッシュ化 → 実行サマリ保存

2. GitHub Actions 自動化
- ワークフロー: `.github/workflows/ae-framework-evaluation.yml`
- トリガー: `push`, `pull_request`, `schedule`, `workflow_dispatch`
- 実施内容: ae-framework を取得し、評価スクリプトを自動実行

3. 生成物の自動保存
- 非PRイベントでは `.ae/`, `.kiro/`, `artifacts/` の差分を自動コミット
- 目的: 中間生成物を GitHub 上に恒久保存し、評価可能にする

## 5. 成果物保存仕様
- 保存先:
  - `.ae/` : AE-IR とハッシュ
  - `.kiro/` : export成果物
  - `artifacts/runs/<UTCタイムスタンプ>/` : 実行単位の証跡
  - `artifacts/bootstrap/` : 初期化時点の記録
- 命名:
  - 実行ディレクトリ: `YYYYMMDDTHHMMSSZ`
- 追跡要件:
  - すべて Git 管理対象（`.gitignore` で除外しない）

## 6. 運用ルール
- 仕様変更時は必ず `evaluation-run.sh` を実行し、生成差分を同一PRでコミットする。
- 失敗時は `artifacts/runs/<ts>/summary.json` を根拠に原因を記録する。
