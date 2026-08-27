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
import { candidateModelResidencyOnly } from '../scripts/run-m6-candidate-evidence.js';
import { suite, summary, test } from './harness.js';
import registry from './registry.json' with { type: 'json' };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite('M6 locked candidate execution plan');

test('plan is argument-free, serial and covers the exact ACTIVE required registry', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const validation = validateM6CandidateExecutionPlan(plan, registry);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(plan.acceptsArguments, false);
  assert.equal(plan.concurrency, 1);
  assert.deepEqual(plan.phases.map(phase => phase.id), M6_CANDIDATE_PHASE_IDS);
  const expected = registry.suites
    .filter(program => program.required === true && program.state === 'ACTIVE')
    .map(program => program.id)
    .sort();
  const selected = plan.phases.flatMap(phase => phase.programIds).sort();
  assert.deepEqual(selected, expected);
  assert.equal(selected.length, 369);
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

test('model and server phase includes every remaining required program, including declared external tests', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const byId = new Map(registry.suites.map(program => [program.id, program]));
  const phase = plan.phases.find(item => item.id === 'model-and-server');
  assert.equal(phase.programIds.length, 58);
  assert.equal(phase.programIds.filter(id => byId.get(id).profile === 'model').length, 47);
  assert.equal(phase.programIds.filter(id => byId.get(id).profile === 'server').length, 11);
  assert(phase.programIds.some(id => byId.get(id).requirements.network === 'external'));
});

test('candidate runner materializes only named toolchain bindings', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'run-m6-candidate-evidence.js'),
    'utf8',
  );
  assert.match(source, /resolvePdfPythonInterpreter\(process\.env\)/u);
  assert.match(source, /environment\.INTENTSMITH_PDF_PYTHON = pdfPython/u);
  assert.match(source, /environment\.C3_PDF_PYTHON = pdfPython/u);
  assert.match(source, /npm_config_devdir: nodeGypCache/u);
  assert.match(source, /electron_config_cache: electronCache/u);
  assert.match(source, /electronHeaders: await copyCacheIfPresent/u);
  assert.doesNotMatch(source, /\.\.\.process\.env/u);
});

test('pre-physical wait recognizes only the candidate-owned Ollama residency', () => {
  const candidateIdentity = {
    state: 'observed',
    uid: 997,
    executable: '/usr/local/lib/ollama/llama-server',
    executableState: 'observed',
    executableErrorCode: null,
    candidateWorkerBound: true,
    candidateWorkerUid: true,
    candidateModelArgument: true,
    candidateMmprojArgument: true,
    loopbackHost: true,
    offline: true,
  };
  const owned = {
    compute: [{
      pid: 101,
      processName: '/usr/local/lib/ollama/llama-server',
      usedMemoryMiB: 16_000,
      identity: candidateIdentity,
    }],
    ollama: {
      runningRows: ['qwen3.5:27b  7653528ba5cb  16 GB  100% GPU  4096  4 minutes'],
    },
  };
  assert.equal(candidateModelResidencyOnly(owned), true);
  // Ollama registers and unregisters its public row after/before the exact worker
  // becomes visible to the NVIDIA driver. Both transition directions must wait.
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    ollama: { runningRows: [] },
  }), true);
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    compute: [{
      ...owned.compute[0],
      identity: {
        ...candidateIdentity,
        executable: null,
        executableState: 'unreadable',
        executableErrorCode: 'EACCES',
      },
    }],
  }), true);
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    compute: [],
  }), true);
  assert.equal(candidateModelResidencyOnly({
    compute: [{ ...owned.compute[0], identity: { state: 'gone', errorCode: 'ENOENT' } }],
    ollama: { runningRows: [] },
  }), true);
  for (const mutation of [
    { compute: [], ollama: { runningRows: [] } },
    { ...owned, compute: [{ ...owned.compute[0], processName: '/usr/bin/python' }] },
    { ...owned, compute: [{ ...owned.compute[0], processName: '/foreign/llama-server' }] },
    { ...owned, compute: [{ ...owned.compute[0], identity: { state: 'unreadable', errorCode: 'EACCES' } }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateWorkerBound: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateWorkerUid: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateModelArgument: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateMmprojArgument: false },
    }] },
    { ...owned, ollama: { runningRows: ['qwen3.5:27b wrongdigest 16 GB 100% GPU 4096 4 minutes'] } },
    { ...owned, ollama: { runningRows: ['foreign:latest id 16 GB 100% GPU 4096 4 minutes'] } },
    { ...owned, ollama: { runningRows: [...owned.ollama.runningRows, owned.ollama.runningRows[0]] } },
  ]) assert.equal(candidateModelResidencyOnly(mutation), false);
});

test('duplicate, reordered, concurrent, uncovered or unexpected plans fail closed', () => {
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
