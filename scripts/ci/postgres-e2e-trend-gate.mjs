#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function parseRatio(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return fallback;
  }
  return n;
}

async function main() {
  const trendPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!trendPath || !outputPath) {
    throw new Error('Usage: node scripts/ci/postgres-e2e-trend-gate.mjs <trend-json> <output-json>');
  }

  const minCompletedRuns = parsePositiveInt(process.env.POSTGRES_E2E_GATE_MIN_COMPLETED_RUNS, 5);
  const minSuccessRate = parseRatio(process.env.POSTGRES_E2E_GATE_MIN_SUCCESS_RATE, 0.95);
  const maxRerunRate = parseRatio(process.env.POSTGRES_E2E_GATE_MAX_RERUN_RATE, 0.2);
  const enforce = String(process.env.POSTGRES_E2E_GATE_ENFORCE ?? '').toLowerCase() === 'true';

  const trend = JSON.parse(await readFile(trendPath, 'utf-8'));
  const report = {
    generatedAtUtc: new Date().toISOString(),
    source: trendPath,
    thresholds: {
      minCompletedRuns,
      minSuccessRate,
      maxRerunRate
    },
    enforce,
    status: 'skipped',
    checks: {},
    failures: []
  };

  if (trend.status !== 'ok') {
    report.status = 'skipped';
    report.failures.push(`trend report is not usable: status=${trend.status}`);
  } else {
    const completedRuns = Number(trend.completedRuns ?? 0);
    const successRate = trend.successRate === null ? null : Number(trend.successRate);
    const rerunRate = completedRuns === 0 ? null : Number((Number(trend.rerunCount ?? 0) / completedRuns).toFixed(4));

    report.checks = {
      completedRuns,
      successRate,
      rerunRate
    };

    if (completedRuns < minCompletedRuns) {
      report.status = 'insufficient_data';
      report.failures.push(`completedRuns ${completedRuns} < minCompletedRuns ${minCompletedRuns}`);
    } else {
      report.status = 'pass';
      if (successRate === null || successRate < minSuccessRate) {
        report.status = 'fail';
        report.failures.push(`successRate ${successRate ?? 'null'} < minSuccessRate ${minSuccessRate}`);
      }
      if (rerunRate === null || rerunRate > maxRerunRate) {
        report.status = 'fail';
        report.failures.push(`rerunRate ${rerunRate ?? 'null'} > maxRerunRate ${maxRerunRate}`);
      }
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  console.log(
    `postgres-e2e gate: status=${report.status}, enforce=${report.enforce}, output=${outputPath}, failures=${report.failures.length}`
  );

  if (report.enforce && report.status === 'fail') {
    process.exit(2);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
