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
- 出力: `artifacts/runs/<ts>/ae-traceability.log`

5. `ae user-stories --generate`（Phase 1以降）
- 用途: 仕様からユーザーストーリー候補を抽出し、要件抜けを検知する
- 出力: `artifacts/runs/<ts>/ae-user-stories.log`

6. `ae conformance verify/report`（Phase 2以降）
- 用途: 実行時ルール適合性の検証
- 出力: `artifacts/hermetic-reports/conformance/`

7. `test:acceptance` / `test:property` / `test:mbt` / `test:e2e:postgres` / `pipelines:mutation:quick`（Phase 1〜3）
- 用途: 不変条件・状態遷移・退行耐性の検証
- 出力: `artifacts/properties/`, `artifacts/mbt/`, `reports/` 等

## 4. 自動化方針（可能な限り自動化）
1. ローカル自動化
- スクリプト: `scripts/ae/evaluation-run.sh`
- 実施内容: validate → lint → export → ハッシュ化 → 実行サマリ保存

1.1 実装検証付きローカル自動化（Phase 1）
- スクリプト: `scripts/ae/phase1-run.sh`
- 実施内容: `typecheck` → `test` → `evaluation-run` → `traceability` → `user-stories` の一括実行
- 出力: `artifacts/runs/<ts>/phase1-summary.json`

1.2 実装検証＋受入レポート付き自動化（Phase 2）
- スクリプト: `scripts/ae/phase2-run.sh`
- 実施内容: `typecheck` → `test` → `build` → `test:acceptance:report` → `generate-lgacc-summary` → `evaluation-run` → `traceability` → `user-stories`
- 出力: `artifacts/runs/<ts>/phase2-summary.json`, `acceptance-vitest.json`, `acceptance-lgacc-summary.json`

1.3 永続化バックエンド切替
- File: `LEDGER_STATE_BACKEND=file` + `LEDGER_STATE_FILE=<path>`
- PostgreSQL: `LEDGER_STATE_BACKEND=postgres` + `LEDGER_DATABASE_URL` + `LEDGER_STATE_KEY`
- 実装: `src/persistence/file-state-store.ts`, `src/persistence/postgres-state-store.ts`

1.4 読取系レート制御（任意）
- `LEDGER_READ_RATE_LIMIT_WINDOW_MS` + `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS`
- scope別 override:
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_TRANSACTIONS`
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_AUDIT_LOGS`
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_METRICS`
- role別 override:
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_ADMIN`
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_MEMBER`
  - `LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_VIEWER`
- actorキー戦略:
  - `LEDGER_READ_RATE_LIMIT_ACTOR_KEY_STRATEGY`
  - 値: `ip` | `role_ip` | `user` | `role_user`
- バックエンド:
  - `LEDGER_READ_RATE_LIMIT_BACKEND`
  - 値: `memory` | `postgres`
  - `postgres` 指定時は `LEDGER_DATABASE_URL` 必須
  - cleanup設定（postgres）:
    - `LEDGER_READ_RATE_LIMIT_CLEANUP_INTERVAL_MS`
    - `LEDGER_READ_RATE_LIMIT_CLEANUP_RETENTION_MS`
- 対象API: `GET /api/v1/transactions`, `GET /api/v1/audit-logs`, `GET /api/v1/metrics`
- 応答ヘッダ: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 超過時応答: HTTP 429 / `RATE_LIMIT_EXCEEDED` (`Retry-After` を付与)
- 運用監視: `GET /api/v1/metrics` 応答に runtime rate limit counters（scope別 allowed/blocked）を含める

1.5 API運用ルール（実装反映）
- `POST /api/v1/transactions` は `Idempotency-Key` ヘッダを受理し、body `idempotencyKey` と不一致時は `400 IDEMPOTENCY_KEY_MISMATCH` を返す
- `MEMBER` ロールの取引登録では `createdByUserId` を `x-user-id` で強制上書きし、監査主体のなりすましを防止する

2. GitHub Actions 自動化
- ワークフロー: `.github/workflows/ae-framework-evaluation.yml`
- トリガー: `push`, `pull_request`, `schedule`, `workflow_dispatch`
- 実施内容: ae-framework を取得し、評価スクリプトを自動実行

2.1 PostgreSQL E2E 自動化
- ワークフロー: `.github/workflows/postgres-e2e.yml`
- トリガー: `push`, `pull_request`, `schedule`, `workflow_dispatch`
- 実施内容: PostgreSQL service container 上で `test:e2e:postgres` を実行
  - 対象: `postgres-state-store.e2e`, `postgres-rate-limit.e2e`
- flake対策: `vitest --retry=2`
- トレンド集計: `scripts/ci/postgres-e2e-trend-report.mjs`（GitHub API）
- 信頼性ゲート: `scripts/ci/postgres-e2e-trend-gate.mjs`
  - 閾値: `minCompletedRuns=5`, `minSuccessRate=0.95`, `maxRerunRate=0.20`
  - `schedule` 実行時は gate fail で job を fail
- 出力: `artifacts/runs/<ts>/postgres-e2e-vitest.json`, `postgres-e2e.log`, `postgres-e2e-summary.json`, `postgres-e2e-trend.json`, `postgres-e2e-gate.json`

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
- 実装変更時は `phase1-run.sh` を実行し、`typecheck/test/ae-*` ログを保存する。
- Issue #1 要件コード（LG-*）のカバレッジ更新時は `docs/specs/ISSUE1-TRACEABILITY-MATRIX.md` も同一コミットで更新する。
- 失敗時は `artifacts/runs/<ts>/summary.json` を根拠に原因を記録する。
