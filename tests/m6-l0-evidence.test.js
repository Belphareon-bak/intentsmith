#!/usr/bin/env node

import assert from 'node:assert/strict';

import { M6_L0_EVIDENCE_PROGRAMS } from '../contracts/m6/l0-evidence-v1.js';
import {
  evaluateM6L0Evidence,
  validateM6L0ProgramMap,
} from '../src/release/m6-l0-evidence.js';
import { suite, summary, test } from './harness.js';

const candidateSha = 'a'.repeat(40);
const registryFingerprint = 'b'.repeat(64);
const allProgramIds = [...new Set(Object.values(M6_L0_EVIDENCE_PROGRAMS).flat())];

function registry() {
  return {
    suites: allProgramIds.map(id => ({ id, required: true, state: 'ACTIVE' })),
  };
}

function result(id, overrides = {}) {
  return {
    id,
    status: 'PASS',
    required: true,
    exitCode: 0,
    signal: null,
    timedOut: false,
    sourceRevision: candidateSha,
    cleanup: { checked: true, leakDetected: false, terminated: true },
    sourceTree: { checked: true, clean: true, head: candidateSha },
    logSha256: 'c'.repeat(64),
    ...overrides,
  };
}

function report(programIds = allProgramIds, overrides = {}) {
  return {
    sourceRevision: candidateSha,
    registryHash: registryFingerprint,
    results: programIds.map(id => result(id)),
    ...overrides,
  };
}

function evaluate(reports = [report()], overrides = {}) {
  return evaluateM6L0Evidence({
    candidateSha,
    registryFingerprint,
    registry: registry(),
    reports,
    ...overrides,
  });
}

suite('M6 current L0 evidence matrix');

test('all thirteen invariants require named ACTIVE registry programs', () => {
  const value = validateM6L0ProgramMap(registry());
  assert.equal(value.valid, true);
  assert.equal(Object.keys(M6_L0_EVIDENCE_PROGRAMS).length, 13);
  for (const programIds of Object.values(M6_L0_EVIDENCE_PROGRAMS)) {
    assert(programIds.length > 0);
  }
});

test('clean programs cannot override open or partial semantic invariant states', () => {
  const midpoint = Math.floor(allProgramIds.length / 2);
  const value = evaluate([
    report(allProgramIds.slice(0, midpoint)),
    report(allProgramIds.slice(midpoint)),
  ]);
  assert.equal(value.valid, true);
  assert.equal(value.verdict, 'FAIL');
  assert.equal(value.rows.length, 13);
  assert.equal(value.rows.filter(row => row.status === 'PASS').length, 11);
  assert.deepEqual(
    value.rows.filter(row => row.status !== 'PASS').map(row => [row.id, row.status, row.semanticState]),
    [
      ['L0-11', 'FAIL', 'OPEN_VIOLATION'],
      ['L0-12', 'NOT_RUN', 'PARTIAL'],
    ],
  );
});

test('missing execution remains NOT_RUN and release-blocking', () => {
  const value = evaluate([report(allProgramIds.slice(1))]);
  assert.equal(value.valid, true);
  assert.equal(value.verdict, 'FAIL');
  assert(value.rows.some(row => row.status === 'NOT_RUN'));
});

test('red, timed-out, dirty or leaked result is FAIL', () => {
  for (const overrides of [
    { status: 'FAIL', exitCode: 1 },
    { status: 'TIMEOUT', timedOut: true, exitCode: null },
    { sourceTree: { checked: true, clean: false, head: candidateSha } },
    { cleanup: { checked: true, leakDetected: true, terminated: false } },
  ]) {
    const results = allProgramIds.map(id => result(id));
    results[0] = result(allProgramIds[0], overrides);
    const value = evaluate([report([], { results })]);
    assert.equal(value.verdict, 'FAIL');
    assert(value.rows.some(row => row.status === 'FAIL'));
  }
});

test('report candidate and registry identities cannot be self-asserted', () => {
  assert.equal(evaluate([report([], { sourceRevision: 'd'.repeat(40), results: [] })]).valid, false);
  assert.equal(evaluate([report([], { registryHash: 'e'.repeat(64), results: [] })]).valid, false);
});

test('duplicate suite result across reports is invalid rather than double evidence', () => {
  const duplicate = allProgramIds[0];
  const value = evaluate([report(), report([duplicate])]);
  assert.equal(value.valid, false);
  assert(value.errors.some(error => error.includes('duplicate-program')));
});

test('missing or non-active registry mapping fails closed', () => {
  const missing = registry();
  missing.suites.pop();
  assert.equal(validateM6L0ProgramMap(missing).valid, false);
  const blocked = registry();
  blocked.suites[0].state = 'BLOCKED';
  assert.equal(validateM6L0ProgramMap(blocked).valid, false);
});

summary();
