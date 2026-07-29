import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { BaselineDifference, RunArtifact, ScenarioRecord } from './types.js';
import { canonicalJson } from './safety.js';

export function compareBaseline(
  baseline: Pick<RunArtifact, 'fingerprints' | 'scenarios'>,
  current: Pick<RunArtifact, 'fingerprints' | 'scenarios'>,
): BaselineDifference[] {
  const differences: BaselineDifference[] = [];
  if (baseline.fingerprints.sourceCommit !== current.fingerprints.sourceCommit) {
    differences.push({
      path: 'fingerprints.sourceCommit',
      baseline: baseline.fingerprints.sourceCommit,
      current: current.fingerprints.sourceCommit,
      deterministicInvariant: true,
    });
  }
  const baselineScenarios = new Map(baseline.scenarios.map(scenario => [scenario.id, scenario]));
  for (const scenario of current.scenarios) {
    const previous = baselineScenarios.get(scenario.id);
    if (!previous || previous.deterministicVerdict !== scenario.deterministicVerdict) {
      differences.push({
        path: `scenarios.${scenario.id}.deterministicVerdict`,
        baseline: previous?.deterministicVerdict ?? null,
        current: scenario.deterministicVerdict ?? null,
        deterministicInvariant: false,
      });
    }
  }
  return differences;
}

function counts(records: readonly ScenarioRecord[]): Record<'PASS' | 'FAIL' | 'BLOCKED' | 'PENDING', number> {
  return records.reduce(
    (result, record) => {
      result[record.deterministicVerdict ?? 'PENDING'] += 1;
      return result;
    },
    { PASS: 0, FAIL: 0, BLOCKED: 0, PENDING: 0 },
  );
}

export function renderMarkdown(artifact: RunArtifact): string {
  const totals = counts(artifact.scenarios);
  const clusters = new Map<string, string[]>();
  for (const scenario of artifact.scenarios) {
    const latest = scenario.attempts.at(-1);
    const key = latest?.reason?.code ?? scenario.deterministicVerdict ?? 'PENDING';
    const current = clusters.get(key) ?? [];
    current.push(scenario.id);
    clusters.set(key, current);
  }
  const rows = artifact.scenarios.map(
    scenario =>
      `| ${scenario.id} | ${scenario.version} | ${scenario.deterministicVerdict ?? 'PENDING'} | ${scenario.attempts.length} |`,
  );
  const clusterRows = [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, scenarios]) => `- ${reason}: ${scenarios.sort().join(', ')}`);

  return [
    '# IntentSmith Local Validation Result',
    '',
    `Authoritative JSON: \`${artifact.runId}/result.json\``,
    '',
    `Source: \`${artifact.fingerprints.sourceCommit}\``,
    `Completed: ${artifact.completedAt}`,
    `Totals: PASS ${totals.PASS}, FAIL ${totals.FAIL}, BLOCKED ${totals.BLOCKED}, PENDING ${totals.PENDING}`,
    '',
    '| Scenario | Version | Verdict | Attempts |',
    '| --- | --- | --- | ---: |',
    ...rows,
    '',
    '## Clusters',
    '',
    ...(clusterRows.length > 0 ? clusterRows : ['- none']),
    '',
    `Baseline differences: ${artifact.baselineDifferences.length}`,
    '',
  ].join('\n');
}

export async function writeReports(jsonPath: string, markdownPath: string, artifact: RunArtifact): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  const temporary = `${jsonPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, jsonPath);
  // Markdown is generated only from the exact in-memory object serialized above.
  await writeFile(markdownPath, renderMarkdown(artifact), 'utf8');
}

export async function assertMarkdownDerived(jsonPath: string, markdownPath: string): Promise<void> {
  const artifact = JSON.parse(await readFile(jsonPath, 'utf8')) as RunArtifact;
  const markdown = await readFile(markdownPath, 'utf8');
  if (canonicalJson(markdown) !== canonicalJson(renderMarkdown(artifact))) {
    throw new Error('Markdown does not agree with the authoritative JSON artifact.');
  }
}
