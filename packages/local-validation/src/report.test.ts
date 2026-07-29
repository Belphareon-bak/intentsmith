import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertMarkdownDerived, compareBaseline, renderMarkdown, writeReports } from './report.js';
import type { RunArtifact, ScenarioRecord } from './types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function record(id: string, verdict: ScenarioRecord['deterministicVerdict']): ScenarioRecord {
  return { id, version: '1', schedulerState: 'COMPLETED', attempts: [], deterministicVerdict: verdict };
}

function artifact(scenarios: ScenarioRecord[]): RunArtifact {
  return {
    schemaVersion: 1,
    runId: 'night-1',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T01:00:00.000Z',
    completedAt: '2026-07-29T01:00:00.000Z',
    fingerprints: {
      sourceCommit: 'd'.repeat(40),
      runnerVersion: '0.1.0',
      scenarioManifest: 'manifest',
      modelProfile: 'profile',
      options: 'options',
    },
    scenarios,
    baselinePath: 'artifacts/local-validation-baseline.json',
    baselineDifferences: [],
  };
}

describe('authoritative JSON and derived reporting', () => {
  it('generates Markdown that agrees exactly with the JSON artifact', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'intentsmith-lv-report-'));
    roots.push(root);
    const jsonPath = resolve(root, 'result.json');
    const markdownPath = resolve(root, 'result.md');
    const value = artifact([record('pass', 'PASS'), record('fail', 'FAIL'), record('blocked', 'BLOCKED')]);
    await writeReports(jsonPath, markdownPath, value);
    await expect(assertMarkdownDerived(jsonPath, markdownPath)).resolves.toBeUndefined();
    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toBe(renderMarkdown(value));
    expect(markdown).toContain('Totals: PASS 1, FAIL 1, BLOCKED 1, PENDING 0');
  });

  it('treats baseline differences as evidence and marks only true invariants', () => {
    const baseline = artifact([record('scenario', 'PASS')]);
    const current = artifact([record('scenario', 'FAIL')]);
    current.fingerprints.sourceCommit = 'e'.repeat(40);
    expect(compareBaseline(baseline, current)).toEqual([
      expect.objectContaining({ path: 'fingerprints.sourceCommit', deterministicInvariant: true }),
      expect.objectContaining({ path: 'scenarios.scenario.deterministicVerdict', deterministicInvariant: false }),
    ]);
  });
});
