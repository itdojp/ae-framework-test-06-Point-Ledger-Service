#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function parseResponseJson(response, text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub API returned non-JSON response (status=${response.status})`);
  }
}

async function fetchRuns({ repository, workflowFile, token, perPage, maxPages }) {
  const runs = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs`);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'postgres-e2e-trend-report'
      }
    });
    const bodyText = await response.text();
    const body = parseResponseJson(response, bodyText);
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`;
      throw new Error(`Failed to fetch workflow runs: ${message}`);
    }
    const pageRuns = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    runs.push(...pageRuns);
    if (pageRuns.length < perPage) {
      break;
    }
  }
  return runs;
}

function aggregateRuns(runs, cutoffMs) {
  const inWindow = runs.filter((run) => {
    const created = Date.parse(String(run.created_at ?? ''));
    return Number.isFinite(created) && created >= cutoffMs;
  });
  const completed = inWindow.filter((run) => run.status === 'completed');
  const countsByConclusion = {};
  const countsByEvent = {};

  for (const run of completed) {
    const conclusion = String(run.conclusion ?? 'unknown');
    countsByConclusion[conclusion] = (countsByConclusion[conclusion] ?? 0) + 1;
    const event = String(run.event ?? 'unknown');
    countsByEvent[event] = (countsByEvent[event] ?? 0) + 1;
  }

  const successCount = countsByConclusion.success ?? 0;
  const totalCompleted = completed.length;
  const successRate = totalCompleted === 0 ? null : Number((successCount / totalCompleted).toFixed(4));

  const recentFailures = completed
    .filter((run) => run.conclusion !== 'success')
    .slice(0, 10)
    .map((run) => ({
      id: run.id,
      runNumber: run.run_number,
      attempt: run.run_attempt,
      event: run.event,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      url: run.html_url
    }));

  const rerunCount = completed.filter((run) => Number(run.run_attempt ?? 1) > 1).length;

  return {
    sampledRuns: runs.length,
    inWindowRuns: inWindow.length,
    completedRuns: totalCompleted,
    countsByConclusion,
    countsByEvent,
    successRate,
    rerunCount,
    recentFailures
  };
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error('Usage: node scripts/ci/postgres-e2e-trend-report.mjs <output-path>');
  }

  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';
  const workflowFile = process.env.POSTGRES_E2E_WORKFLOW_FILE ?? 'postgres-e2e.yml';
  const windowDays = parsePositiveInt(process.env.POSTGRES_E2E_TREND_WINDOW_DAYS, 14);
  const perPage = parsePositiveInt(process.env.POSTGRES_E2E_TREND_PER_PAGE, 100);
  const maxPages = parsePositiveInt(process.env.POSTGRES_E2E_TREND_MAX_PAGES, 5);
  const generatedAt = new Date();
  const generatedAtUtc = generatedAt.toISOString();
  const cutoffMs = generatedAt.getTime() - windowDays * 24 * 60 * 60 * 1000;

  let report;
  if (!repository || !token) {
    report = {
      generatedAtUtc,
      workflow: workflowFile,
      windowDays,
      status: 'skipped',
      reason: 'GITHUB_REPOSITORY or GITHUB_TOKEN is not set'
    };
  } else {
    const runs = await fetchRuns({ repository, workflowFile, token, perPage, maxPages });
    report = {
      generatedAtUtc,
      repository,
      workflow: workflowFile,
      windowDays,
      windowStartUtc: new Date(cutoffMs).toISOString(),
      status: 'ok',
      ...aggregateRuns(runs, cutoffMs)
    };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  if (report.status === 'ok') {
    const rate = report.successRate === null ? 'n/a' : `${(report.successRate * 100).toFixed(2)}%`;
    console.log(
      `postgres-e2e trend: completed=${report.completedRuns}, successRate=${rate}, reruns=${report.rerunCount}, output=${outputPath}`
    );
  } else {
    console.log(`postgres-e2e trend: skipped (${report.reason}), output=${outputPath}`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
