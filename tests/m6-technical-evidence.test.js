import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  M6_EXTERNAL_AUTHORITY_CHECKS,
} from '../contracts/m6/technical-evidence-v1.js';
import {
  evaluateM6TechnicalEvidence,
  projectM6ReleaseEvidence,
  validateM6TechnicalProgramMap,
} from '../src/release/m6-technical-evidence.js';
import { suite, summary, test } from './harness.js';
import registry from './registry.json' with { type: 'json' };

const candidateSha = 'a'.repeat(40);
const registryFingerprint = 'b'.repeat(64);
const artifact = Object.freeze({
  path: '.intentsmith-artifacts/m6/report.json',
  bytes: 123,
  sha256: 'c'.repeat(64),
});

function passingResult(program) {
  return {
    id: program.id,
    required: true,
    status: 'PASS',
    exitCode: 0,
    signal: null,
    timedOut: false,
    sourceRevision: candidateSha,
    cleanup: { checked: true, leakDetected: false, terminated: true },
    sourceTree: { checked: true, clean: true, head: candidateSha },
    logSha256: 'd'.repeat(64),
  };
}

function report(results = registry.suites
  .filter(program => program.required && program.state === 'ACTIVE')
  .map(passingResult)) {
  return {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-report',
    sourceRevision: candidateSha,
    registryHash: registryFingerprint,
    results,
  };
}

function evaluate(reports = [{ report: report(), artifact }]) {
  return evaluateM6TechnicalEvidence({
    candidateSha,
    registryFingerprint,
    registry,
    reports,
  });
}

suite('M6 candidate technical evidence authority');

test('program map names exact active required registry evidence for every technical check', () => {
  const result = validateM6TechnicalProgramMap(registry);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert(result.programSets['deterministic-offline-database'].length > 200);
  assert(result.programSets['soak-nightly-resources'].length >= 10);
});

test('all implementation programs pass but external authorities stay BLOCKED', () => {
  const result = evaluate();
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.verdict, 'BLOCKED');
  for (const id of M6_EXTERNAL_AUTHORITY_CHECKS) {
    const row = result.checks.find(item => item.id === id);
    assert.equal(row.status, 'BLOCKED');
    assert.match(row.reasonCode, /REQUIRES_EXTERNAL_AUTHORITY$/u);
  }
  assert(result.checks
    .filter(row => !M6_EXTERNAL_AUTHORITY_CHECKS.includes(row.id))
    .every(row => row.status === 'PASS'));
  assert(result.l0.every(row => row.status === 'PASS'));
  assert.equal(result.conditionalJourneys[0].status, 'PASS');
});

test('missing execution is NOT_RUN and a red execution is FAIL', () => {
  const passing = report().results;
  const remoteId = 'IS-T1-TESTS-M5-REMOTE-CORE-ADAPTER-TEST';
  const missing = evaluate([{ report: report(passing.filter(item => item.id !== remoteId)), artifact }]);
  assert.equal(missing.checks.find(row => row.id === 'remote-core-port').status, 'NOT_RUN');
  assert.equal(missing.verdict, 'BLOCKED');

  const red = passing.map(item => item.id === remoteId ? { ...item, status: 'FAIL', exitCode: 1 } : item);
  const failed = evaluate([{ report: report(red), artifact }]);
  assert.equal(failed.checks.find(row => row.id === 'remote-core-port').status, 'FAIL');
  assert.equal(failed.verdict, 'FAIL');
});

test('blocked, timed out, leaked, dirty or wrong-candidate PASS cannot become evidence PASS', () => {
  const targetId = 'IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST';
  const variants = [
    item => ({ ...item, status: 'BLOCKED', exitCode: null }),
    item => ({ ...item, timedOut: true }),
    item => ({ ...item, cleanup: { ...item.cleanup, leakDetected: true } }),
    item => ({ ...item, sourceTree: { ...item.sourceTree, clean: false } }),
    item => ({ ...item, sourceRevision: 'e'.repeat(40) }),
  ];
  for (const mutate of variants) {
    const results = report().results.map(item => item.id === targetId ? mutate(item) : item);
    const result = evaluate([{ report: report(results), artifact }]);
    assert.equal(result.checks.find(row => row.id === 'conditional-surfaces').status, 'FAIL');
  }
});

test('report candidate, registry, contract, artifact and duplicate program binding fail closed', () => {
  for (const mutate of [
    item => { item.report.sourceRevision = 'e'.repeat(40); },
    item => { item.report.registryHash = 'f'.repeat(64); },
    item => { item.report.manifestType = 'forged'; },
    item => { item.artifact.sha256 = 'bad'; },
    item => { item.report.results.push(item.report.results[0]); },
  ]) {
    const item = { report: structuredClone(report()), artifact: { ...artifact } };
    mutate(item);
    const result = evaluate([item]);
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'FAIL');
  }
});

test('release projection removes diagnostic internals but preserves truthful blocking', () => {
  const technical = evaluate();
  const projected = projectM6ReleaseEvidence({
    candidateSha,
    registryFingerprint,
    generatedAt: '2026-08-27T00:00:00.000Z',
    technicalEvidence: technical,
  });
  assert.equal(projected.checks.find(row => row.id === 'm5-acceptance').status, 'BLOCKED');
  assert.deepEqual(Object.keys(projected.checks[0]).sort(), [
    'artifacts',
    'id',
    'reasonCode',
    'status',
  ]);
  assert.equal(Object.isFrozen(projected), true);
});

summary();

