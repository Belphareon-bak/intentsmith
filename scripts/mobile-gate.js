#!/usr/bin/env node

// The mobile gate — one command, and the registry decides what is in it.
// ==============================================================================
//
// **Why this exists.**  `npm run test:mobile` used to be a hand-written `&&`
// chain of suite paths.  A hand-written list of tests drifts the moment someone
// registers a suite without editing it, and it drifts *silently*: the gate goes
// green because it never ran the thing that would have failed.  That is exactly
// what happened — `tests/mobile-navbar-ring-turn.test.js` was registered in
// `tests/registry.json` and never added to the chain, so the gate would have
// reported success while skipping it.
//
// `tests/registry.json` is already the single source of truth: the audit runner
// selects from it, `scripts/validate-test-registry.js` validates it, and
// `tests/artifact-validation.test.js` binds the root README census to it.  So
// the gate derives its set from the registry rather than restating it.
//
// **What it does not do.**  This is not the nightly audit and does not pretend
// to be Gate 0: no private filesystem sandbox, no toolchain probe, no evidence
// artifact.  It is the fast local gate for mobile work.  The authority for a
// verdict remains `npm run test:deterministic`.
//
// Suites whose registry `state` is not `ACTIVE` are **reported, not run** —
// a `BLOCKED` suite has a declared prerequisite (`mobile-browser-a11y` needs a
// Chromium runtime), and quietly running it on a machine that happens to have
// one would be the same false comfort in the other direction.
//
// ==============================================================================

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REGISTRY = path.join(REPOSITORY_ROOT, 'tests', 'registry.json');
const MOBILE_PREFIX = 'tests/mobile-';

/** Every registered mobile program, in a stable order. */
function mobileSuites() {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  if (!Array.isArray(registry.suites)) {
    throw new Error('tests/registry.json has no suites array');
  }
  return registry.suites
    .filter(suite => typeof suite.path === 'string' && suite.path.startsWith(MOBILE_PREFIX))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function run(suite) {
  const argv = Array.isArray(suite.argv) && suite.argv.length
    ? suite.argv
    : ['node', suite.path];
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: suite.timeoutMs || 300_000,
  });
  return {
    ms: Date.now() - started,
    code: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

const suites = mobileSuites();
const active = suites.filter(suite => suite.state === 'ACTIVE');
const withheld = suites.filter(suite => suite.state !== 'ACTIVE');

console.log(`Mobile gate — ${active.length} active of ${suites.length} registered\n`);

const failures = [];
for (const [index, suite] of active.entries()) {
  const label = `[${index + 1}/${active.length}] ${suite.path}`;
  const outcome = run(suite);
  if (outcome.code === 0) {
    console.log(`  PASS ${label} (${outcome.ms}ms)`);
    continue;
  }
  const why = outcome.timedOut ? `timed out after ${suite.timeoutMs}ms` : `exit ${outcome.code}`;
  console.log(`  FAIL ${label} (${outcome.ms}ms, ${why})`);
  failures.push({ suite, outcome, why });
}

if (withheld.length) {
  console.log('\nWithheld — declared prerequisite, not a pass:');
  for (const suite of withheld) {
    const needs = suite.requirements?.toolchain?.join(', ') || 'unstated prerequisite';
    console.log(`  ${suite.state} ${suite.path} (needs ${needs})`);
  }
}

if (failures.length) {
  console.log('\nFailures in full:');
  for (const failure of failures) {
    console.log(`\n───── ${failure.suite.path} (${failure.why}) `.padEnd(78, '─'));
    // The tail is where these suites print their summary; the head is banner.
    const lines = failure.outcome.output.split('\n');
    console.log(lines.slice(-40).join('\n'));
  }
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
console.log(
  `\nMobile gate: ${verdict} — ${active.length - failures.length}/${active.length} active`
  + `${withheld.length ? `, ${withheld.length} withheld` : ''}`,
);
process.exit(failures.length === 0 ? 0 : 1);
