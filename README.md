# Point Ledger Service (ae-framework Evaluation)

`itdojp/ae-framework` を用いて Point Ledger Service を仕様駆動で開発し、有用性を検証するためのリポジトリです。

## 起点 Issue
- 仕様: `Issue #1` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/1
- 開発開始時環境記録: `Issue #2` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/2
- 開発計画: `Issue #3` https://github.com/itdojp/ae-framework-test-06-Point-Ledger-Service/issues/3

## 参照ドキュメント
- 開発計画: `docs/plans/INITIAL-DEVELOPMENT-PLAN.md`
- ae-framework利用仕様: `docs/specs/AE-FRAMEWORK-UTILIZATION-SPEC.md`
- 初期AE-Spec: `spec/point-ledger-service.ae.md`

## 自動実行（ローカル）
```bash
AE_FRAMEWORK_DIR=../ae-framework ./scripts/ae/evaluation-run.sh
```

## 中間生成物の保存方針
- `artifacts/`、`.ae/`、`.kiro/` を Git 管理対象にする。
- ae-framework 実行で得られた生成物は、評価証跡としてコミット対象にする。
