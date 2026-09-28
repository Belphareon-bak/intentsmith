#!/usr/bin/env node
// The mobile gate's own meta-test — WP-0 P1.
// ==============================================================================
//
// `scripts/mobile-gate.js` decides what the mobile gate runs.  A gate that
// silently omits a suite reports success for work it never did, which is worse
// than no gate at all — so the ways it could omit one are asserted here rather
// than trusted.
//
// The four that matter, each of which was a real possibility in the first
// version of the script:
//
//   * a **nested** suite (`tests/mobile/<area>/<name>.test.js`, the shape
//     `TEST-STRATEGY.md` §11 templates use) must be selected — the first version
//     matched the `tests/mobile-` prefix and would have skipped it;
//   * a **malformed registry** must stop the gate, not degrade to "that row is
//     not ACTIVE, so withhold it";
//   * an **empty selection** must fail, never report 0/0 PASS;
//   * a **failing active suite** must make the gate exit non-zero.
//
// Each case runs the real script against a synthetic repository root, so what is
// asserted is the shipped selection logic and not a restatement of it.
//
// ==============================================================================

import './helpers/isolated-test-db.js';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

const realRegistry = JSON.parse(
  readFileSync(path.join(REPOSITORY_ROOT, 'tests', 'registry.json'), 'utf8'),
);

/** A suite row that passes the registry validator, pointed at our fixture. */
function row(overrides) {
  const template = realRegistry.suites.find(suite => (
    suite.capabilityId === 'C3-031' || suite.capabilityId === 'C3-032'
  ));
  assert.ok(template, 'the real registry has no mobile capability template');
  return {
    ...JSON.parse(JSON.stringify(template)),
    lastGreen: { commit: null, artifact: null },
    flakeCount: 0,
    quarantineExpiry: null,
    ...overrides,
  };
}

/**
 * A throwaway repository root with a real `scripts/` and a registry we control.
 *
 * The gate resolves its own location, so the script has to be copied in rather
 * than invoked from the real tree.
 */
function scaffold(suites, { exclusions = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mobile-gate-self-'));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'tests', 'helpers'), { recursive: true });
  // The gate's own static import closure, computed once and stated here so a new
  // dependency fails this test loudly rather than as ERR_MODULE_NOT_FOUND.
  for (const name of ['mobile-gate.js', 'test-registry.js', 'model-fixture-preflight.js']) {
    cpSync(path.join(REPOSITORY_ROOT, 'scripts', name), path.join(root, 'scripts', name));
  }
  writeFileSync(
    path.join(root, 'tests', 'registry.json'),
    JSON.stringify({ ...realRegistry, suites, exclusions }, null, 2),
  );
  return root;
}

/** Write a suite program that exits with `code`, creating directories as needed. */
function program(root, relativePath, code) {
  const full = path.join(root, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, `process.exit(${code});\n`);
}

function runGate(root) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'mobile-gate.js')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

console.log('\n=== Mobile gate self-test (WP-0) ===');

test('a nested mobile suite is selected, not skipped for not matching a path prefix', () => {
  const nested = 'tests/mobile/navigation/ring.test.js';
  const suites = [row({
    id: 'IS-T1-FIXTURE-NESTED', path: nested, argv: ['node', nested], state: 'ACTIVE',
  })];
  const root = scaffold(suites);
  program(root, nested, 0);
  const result = runGate(root);
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.code, 0, result.out);
  assert.ok(result.out.includes(nested),
    `the nested suite never ran — selection is still path-shaped:\n${result.out}`);
  assert.match(result.out, /1\/1 active/);
});

test('a BLOCKED suite is withheld and named, and does not count as a pass', () => {
  const active = 'tests/mobile-active.test.js';
  const blocked = 'tests/mobile-blocked.test.js';
  const suites = [
    row({ id: 'IS-T1-FIXTURE-ACTIVE', path: active, argv: ['node', active], state: 'ACTIVE' }),
    row({
      id: 'IS-T1-FIXTURE-BLOCKED',
      path: blocked,
      argv: ['node', blocked],
      state: 'BLOCKED',
      requirements: { network: 'none', database: false, server: false, ollama: false, gpu: false, toolchain: ['chromium-runtime'] },
    }),
  ];
  const root = scaffold(suites);
  program(root, active, 0);
  program(root, blocked, 1);            // would fail if it were wrongly run
  const result = runGate(root);
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /Withheld/, 'the withheld suite was not reported');
  assert.match(result.out, /chromium-runtime/, 'the prerequisite was not named');
  assert.match(result.out, /1\/1 active, 1 withheld/);
});

test('a malformed registry stops the gate instead of quietly withholding the row', () => {
  const suitePath = 'tests/mobile-typo.test.js';
  const suites = [row({
    id: 'IS-T1-FIXTURE-TYPO', path: suitePath, argv: ['node', suitePath], state: 'ACTIVEE',
  })];
  const root = scaffold(suites);
  program(root, suitePath, 1);
  const result = runGate(root);
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.code, 1, `a typo in \`state\` was tolerated:\n${result.out}`);
  assert.match(result.out, /does not validate/,
    'the gate ran against a registry it had not validated');
  assert.match(result.out, /state is invalid: ACTIVEE/,
    'the offending row was not named, so the operator cannot find it');
  assert.ok(!/^\s*at /m.test(result.out),
    'the refusal surfaced as a stack trace rather than as a sentence');
});

test('an empty selection fails instead of reporting 0/0 PASS', () => {
  const suitePath = 'tests/other-thing.test.js';
  const suites = [row({
    id: 'IS-T1-FIXTURE-OTHER', path: suitePath, argv: ['node', suitePath],
    state: 'ACTIVE', capabilityId: 'C3-002',        // not a mobile capability
  })];
  const root = scaffold(suites);
  program(root, suitePath, 0);
  const result = runGate(root);
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.code, 1, `an empty mobile selection reported success:\n${result.out}`);
  assert.match(result.out, /selection is empty/);
});

test('a failing active suite fails the gate', () => {
  const suitePath = 'tests/mobile-broken.test.js';
  const suites = [row({
    id: 'IS-T1-FIXTURE-BROKEN', path: suitePath, argv: ['node', suitePath], state: 'ACTIVE',
  })];
  const root = scaffold(suites);
  program(root, suitePath, 3);
  const result = runGate(root);
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.code, 1, 'a failing suite did not fail the gate');
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /exit 3/, 'the exit code was not reported');
});

console.log(`\nMobile gate self-test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
