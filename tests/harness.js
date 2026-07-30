// tests/harness.js — Minimal test harness for ESM
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
let currentSuite = '';

export const DEFAULT_ASYNC_TEST_TIMEOUT_MS = 10 * 60 * 1000;

export function suite(name) {
  currentSuite = name;
  console.log(`\n═══ ${name} ${'═'.repeat(Math.max(0, 60 - name.length))}`);
}

function asyncUsageError() {
  return new TypeError(
    'test() does not accept async callbacks or returned thenables; '
    + 'use await testAsync(name, fn, timeoutMs)',
  );
}

function isAsyncFunction(fn) {
  return typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction';
}

function isThenable(value) {
  return (
    (typeof value === 'object' && value !== null)
    || typeof value === 'function'
  ) && typeof value.then === 'function';
}

export function test(name, fn) {
  try {
    if (isAsyncFunction(fn)) {
      throw asyncUsageError();
    }

    const result = fn();
    if (isThenable(result)) {
      Promise.resolve(result).catch(() => {});
      throw asyncUsageError();
    }

    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    console.log(`  ❌ ${name}: ${msg}`);
    failures.push({ suite: currentSuite, test: name, error: msg });
  }
}

async function invokeAsyncTest(fn, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`Invalid test timeout: ${timeoutMs}`);
  }

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`Test timed out after ${timeoutMs}ms`);
      error.code = 'TEST_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function testAsync(name, fn, timeoutMs = DEFAULT_ASYNC_TEST_TIMEOUT_MS) {
  try {
    await invokeAsyncTest(fn, timeoutMs);
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    console.log(`  ❌ ${name}: ${msg}`);
    failures.push({ suite: currentSuite, test: name, error: msg });
  }
}

export function skip(name) {
  skipped++;
  console.log(`  ⏭️  ${name} (skipped)`);
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

export function assertIncludes(str, substr, message) {
  if (!str?.includes(substr)) {
    throw new Error(message || `Expected "${str}" to include "${substr}"`);
  }
}

export function assertThrows(fn, message) {
  try {
    fn();
    throw new Error(message || 'Expected function to throw');
  } catch (e) {
    if (e.message === (message || 'Expected function to throw')) throw e;
    return e;
  }
}

export function assertMatch(str, regex, message) {
  if (!regex.test(str)) {
    throw new Error(message || `Expected "${str}" to match ${regex}`);
  }
}

export function summary() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    ❌ [${f.suite}] ${f.test}: ${f.error}`);
    }
  }

  console.log(`${'═'.repeat(70)}\n`);
  if (failed > 0) {
    process.exitCode ||= 1;
  }
  return { passed, failed, skipped, failures };
}
