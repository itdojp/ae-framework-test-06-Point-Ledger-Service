#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  // eslint-disable-next-line no-console
  console.error('Usage: generate-lgacc-summary.mjs <acceptance-vitest.json> <output.json>');
  process.exit(1);
}

const raw = await readFile(inputPath, 'utf-8');
const report = JSON.parse(raw);
const targetIds = ['LG-ACC-01', 'LG-ACC-02', 'LG-ACC-03', 'LG-ACC-04'];

const assertions = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
const results = targetIds.map((id) => {
  const matched = assertions.find((assertion) => String(assertion.title).includes(id));
  if (!matched) {
    return {
      id,
      status: 'missing',
      testName: null,
      reason: 'No acceptance test matched'
    };
  }
  return {
    id,
    status: matched.status,
    testName: matched.title,
    durationMs: matched.duration ?? null,
    failureMessages: matched.failureMessages ?? []
  };
});

const summary = {
  generatedAtUtc: new Date().toISOString(),
  source: inputPath,
  totals: {
    total: targetIds.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    missing: results.filter((r) => r.status === 'missing').length
  },
  criteria: results
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

// eslint-disable-next-line no-console
console.log(`LG-ACC summary generated: ${outputPath}`);
