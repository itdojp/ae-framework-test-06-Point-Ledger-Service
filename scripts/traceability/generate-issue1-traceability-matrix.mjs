#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function escapeTableCell(value) {
  return String(value).replaceAll('|', '\\|');
}

function code(path) {
  return `\`${path}\``;
}

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const defaultSourcePath = resolve(projectRoot, 'docs/specs/issue1-traceability-map.json');
  const outputPath = process.argv[2];
  const sourcePath = process.argv[3] ?? defaultSourcePath;

  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/traceability/generate-issue1-traceability-matrix.mjs <output-markdown-path> [source-json-path]'
    );
  }

  const updatedAt = process.env.TRACEABILITY_UPDATED_AT ?? '';
  const baseCommit = process.env.TRACEABILITY_BASE_COMMIT ?? '';
  const resolvedSourcePath = resolve(sourcePath);
  const source = JSON.parse(await readFile(resolvedSourcePath, 'utf-8'));
  const sourcePathDisplay = relative(projectRoot, resolvedSourcePath);

  const lines = [];
  lines.push(`# ${source.title}`);
  lines.push('');
  if (updatedAt) {
    lines.push(`最終更新日: ${updatedAt}  `);
  }
  lines.push(`対象仕様: [Issue #1](${source.specUrl})  `);
  if (baseCommit) {
    lines.push(`基準コミット: \`${baseCommit}\`  `);
  }
  lines.push('');

  for (const [index, section] of source.sections.entries()) {
    lines.push(`## ${index + 1}. ${section.title}`);
    lines.push('');
    lines.push('| 要件ID | 検証状態 | 主な証跡 | 備考 |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of section.rows) {
      const evidence = row.evidence.map((item) => code(item)).join(', ');
      lines.push(
        `| ${escapeTableCell(row.id)} | ${escapeTableCell(row.status)} | ${escapeTableCell(evidence)} | ${escapeTableCell(row.note ?? '')} |`
      );
    }
    lines.push('');
  }

  lines.push(`## ${source.sections.length + 1}. 自動化証跡`);
  lines.push('');
  lines.push('- 実装・テスト・ae-framework 実行証跡は `artifacts/runs/<timestamp>/` に保存');
  lines.push(`- トレーサビリティ定義ソース: \`${sourcePathDisplay}\``);
  for (const item of source.automationEvidence) {
    lines.push(`- \`${item}\``);
  }
  lines.push('');
  lines.push('<!-- generated: scripts/traceability/generate-issue1-traceability-matrix.mjs -->');
  lines.push('');

  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${lines.join('\n')}`, 'utf-8');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
