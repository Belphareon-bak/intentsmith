import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  M6_CANDIDATE_PHASE_IDS,
  M6_DIRECT_FRESH_CLONE_PROGRAMS,
  M6_PHYSICAL_GPU_PROGRAMS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  buildM6CandidateExecutionPlan,
  validateM6CandidateExecutionPlan,
} from '../src/release/m6-candidate-plan.js';
import { suite, summary, test } from './harness.js';
import registry from './registry.json' with { type: 'json' };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite('M6 locked candidate execution plan');

test('plan is argument-free, serial and covers deterministic plus every ACTIVE soak program', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const validation = validateM6CandidateExecutionPlan(plan, registry);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(plan.acceptsArguments, false);
  assert.equal(plan.concurrency, 1);
  assert.deepEqual(plan.phases.map(phase => phase.id), M6_CANDIDATE_PHASE_IDS);
  assert.equal(Object.isFrozen(plan), true);
});

test('fresh-clone and physical GPU programs cannot be silently omitted', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const selected = new Set(plan.phases.flatMap(phase => phase.programIds));
  for (const id of [...M6_DIRECT_FRESH_CLONE_PROGRAMS, ...M6_PHYSICAL_GPU_PROGRAMS]) {
    assert.equal(selected.has(id), true, id);
  }
  assert.equal(plan.phases.find(phase => phase.id === 'fresh-clone-install-build-studio')
    .requiresFreshClone, true);
  assert.equal(plan.phases.find(phase => phase.id === 'physical-ollama-gpu')
    .requiresGpuCensus, true);
});

test('no selected program may require external network', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const byId = new Map(registry.suites.map(program => [program.id, program]));
  for (const id of plan.phases.flatMap(phase => phase.programIds)) {
    assert.notEqual(byId.get(id).requirements.network, 'external', id);
  }
});

test('candidate runner preserves only the named PDF toolchain bindings', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'run-m6-candidate-evidence.js'),
    'utf8',
  );
  assert.match(source, /resolvePdfPythonInterpreter\(process\.env\)/u);
  assert.match(source, /environment\.INTENTSMITH_PDF_PYTHON = pdfPython/u);
  assert.match(source, /environment\.C3_PDF_PYTHON = pdfPython/u);
  assert.doesNotMatch(source, /\.\.\.process\.env/u);
});

test('duplicate, reordered, concurrent or external-network plans fail closed', () => {
  const base = buildM6CandidateExecutionPlan(registry);
  for (const mutate of [
    plan => { plan.concurrency = 2; },
    plan => { plan.phases.reverse(); },
    plan => { plan.phases[1].programIds.push(plan.phases[0].programIds[0]); },
    plan => { plan.phases[0].programIds.push('IS-T3-TESTS-CHAT-QUALITY-TEST'); },
    plan => { plan.phases[2].programIds.pop(); },
  ]) {
    const plan = structuredClone(base);
    mutate(plan);
    assert.equal(validateM6CandidateExecutionPlan(plan, registry).valid, false);
  }
});

summary();
