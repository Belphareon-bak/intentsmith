// tests/harness.js — Minimal test harness for ESM
// ══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
let currentSuite = '';

export function suite(name) {
  currentSuite = name;
  console.log(`\n═══ ${name} ${'═'.repeat(Math.max(0, 60 - name.length))}`);
}

export function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    console.log(`  ❌ ${name}: ${msg}`);
    failures.push({ suite: currentSuite, test: name, error: msg });
  }
}

export async function testAsync(name, fn) {
  try {
    await fn();
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
  return { passed, failed, skipped, failures };
}
