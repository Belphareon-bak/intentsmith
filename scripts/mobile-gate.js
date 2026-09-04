#!/usr/bin/env node

// The mobile gate — one command, and the validated registry decides what is in it.
// ==============================================================================
//
// **Why this exists.**  `npm run test:mobile` used to be a hand-written `&&`
// chain of suite paths.  A hand-written list drifts the moment someone registers
// a suite without editing it, and it drifts *silently*: the gate goes green
// because it never ran the thing that would have failed.  That is exactly what
// happened — `tests/mobile-navbar-ring-turn.test.js` was registered and never
// added to the chain.
//
// **Why it selects by capability, not by filename.**  The first version of this
// script matched `tests/mobile-`.  That reintroduced the same silent-skip class
// it was written to remove: `TEST-STRATEGY.md` §11 templates register suites as
// `tests/mobile/<area>/<name>.test.js`, and a nested suite would have been
// registered, validated, and quietly left out of the gate.  `capabilityId` is
// the property that actually means "this is mobile" — `C3-031` and `C3-032` —
// and it does not move when a file does.  The registry remains the only source
// of the current suite count, so adding a surface cannot leave this gate stale.
//
// **Why it validates first.**  Reading `tests/registry.json` raw would let a
// malformed row through: a typo in `state` would silently become "not ACTIVE",
// i.e. withheld, i.e. not run — silent skip again, one level down.  The registry
// has a validator (`scripts/test-registry.js`) that the audit runner and
// `npm run test:registry` already use, so the gate uses it too and refuses to
// run against a registry that does not pass it.
//
// **What it does not do.**  This is not the nightly audit and is not Gate 0: no
// private filesystem sandbox, no toolchain probe, no evidence artifact.  It is
// the fast local gate for mobile work; the authority for a verdict remains
// `npm run test:deterministic`.  A suite whose state is not `ACTIVE` is reported
// and **not run** — running a `BLOCKED` suite on a machine that happens to
// satisfy its prerequisite is the same false comfort as skipping an active one.
//
// ==============================================================================

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTestRegistry } from './test-registry.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The capabilities that mean "mobile".  Not a path convention — a property. */
const MOBILE_CAPABILITIES = new Set(['C3-031', 'C3-032']);

/**
 * Why a suite is being withheld, in its own words.
 *
 * `BLOCKED` has a declared prerequisite; the other states do not, and calling
 * them all "prerequisite" would misreport a quarantined or retired suite as
 * merely un-runnable here.
 */
function withheldBecause(suite) {
  if (suite.state === 'BLOCKED') {
    const toolchain = suite.requirements?.toolchain;
    return `prerequisite: ${toolchain?.length ? toolchain.join(', ') : 'declared but unnamed'}`;
  }
  if (suite.state === 'KNOWN_DEFECTIVE') return 'known defective — a recorded defect, not a prerequisite';
  if (suite.state === 'HISTORICAL') return 'historical — retained for the record, not for running';
  if (suite.state === 'QUARANTINED') return `quarantined until ${suite.quarantineExpiry || 'an unstated date'}`;
  return `state ${suite.state}`;
}

function run(suite) {
  const argv = Array.isArray(suite.argv) && suite.argv.length ? suite.argv : ['node', suite.path];
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

function fail(message) {
  console.error(`Mobile gate: ${message}`);
  process.exit(1);
}

// `loadTestRegistry` discovers the runnable programs and runs the full
// validator itself, throwing on the first problem — so this is not merely
// reading the file.  Reading `tests/registry.json` raw, as the first version
// did, would let a typo in `state` degrade into "not ACTIVE", i.e. withheld,
// i.e. silently not run.  The throw is caught only to replace a stack trace
// with a sentence; the refusal itself is the point.
let registry;
try {
  registry = await loadTestRegistry(REPOSITORY_ROOT);
} catch (error) {
  fail(`the registry does not validate, so its selection cannot be trusted:\n  ${error.message}`);
}

const suites = registry.suites
  .filter(suite => MOBILE_CAPABILITIES.has(suite.capabilityId))
  .sort((left, right) => left.path.localeCompare(right.path));

// An empty selection is a broken gate reporting success, which is the one
// outcome this script exists to make impossible.
if (suites.length === 0) {
  fail(`no suite carries a mobile capability (${[...MOBILE_CAPABILITIES].join(', ')}) — selection is empty`);
}

const active = suites.filter(suite => suite.state === 'ACTIVE');
const withheld = suites.filter(suite => suite.state !== 'ACTIVE');
if (active.length === 0) {
  fail(`all ${suites.length} mobile suites are withheld — nothing would run`);
}

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
  console.log('\nWithheld — not run, and not a pass:');
  for (const suite of withheld) {
    console.log(`  ${suite.state} ${suite.path} (${withheldBecause(suite)})`);
  }
}

if (failures.length) {
  console.log('\nFailures in full:');
  for (const failure of failures) {
    console.log(`\n───── ${failure.suite.path} (${failure.why}) `.padEnd(78, '─'));
    console.log(failure.outcome.output.split('\n').slice(-40).join('\n'));
  }
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
console.log(
  `\nMobile gate: ${verdict} — ${active.length - failures.length}/${active.length} active`
  + `${withheld.length ? `, ${withheld.length} withheld` : ''}`,
);
process.exit(failures.length === 0 ? 0 : 1);
