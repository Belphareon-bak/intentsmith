// C.3 v35.1 E2E Test Runner
// ══════════════════════════════════════════════════════════════════════════════
// Minimalistický test runner pro P0 E2E scénáře
// Spuštění: node src/tests/e2e-runner.js
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

const testQueue = [];
let currentDescribe = '';

export function describe(name, fn) {
  currentDescribe = name;
  fn();
}

export function test(name, fn) {
  testQueue.push({
    describe: currentDescribe,
    name,
    fn
  });
}

export function skip(name, fn) {
  testQueue.push({
    describe: currentDescribe,
    name,
    fn: null,
    skipped: true
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ════════════════════════════════════════════════════════════════════════════

export const expect = (actual) => ({
  toBe: (expected) => {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  
  toEqual: (expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  
  toBeTruthy: () => {
    if (!actual) {
      throw new Error(`Expected truthy value, got ${JSON.stringify(actual)}`);
    }
  },
  
  toBeFalsy: () => {
    if (actual) {
      throw new Error(`Expected falsy value, got ${JSON.stringify(actual)}`);
    }
  },
  
  toBeGreaterThan: (expected) => {
    if (!(actual > expected)) {
      throw new Error(`Expected ${actual} to be greater than ${expected}`);
    }
  },
  
  toBeGreaterThanOrEqual: (expected) => {
    if (!(actual >= expected)) {
      throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
    }
  },
  
  toBeLessThan: (expected) => {
    if (!(actual < expected)) {
      throw new Error(`Expected ${actual} to be less than ${expected}`);
    }
  },
  
  toBeLessThanOrEqual: (expected) => {
    if (!(actual <= expected)) {
      throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
    }
  },
  
  toBeDefined: () => {
    if (actual === undefined) {
      throw new Error(`Expected value to be defined, got undefined`);
    }
  },
  
  toBeNull: () => {
    if (actual !== null) {
      throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    }
  },
  
  toContain: (expected) => {
    if (typeof actual === 'string') {
      if (!actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    } else if (Array.isArray(actual)) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected array to contain ${JSON.stringify(expected)}`);
      }
    }
  },
  
  not: {
    toBe: (expected) => {
      if (actual === expected) {
        throw new Error(`Expected NOT ${JSON.stringify(expected)}, but got it`);
      }
    },
    
    toContain: (expected) => {
      if (typeof actual === 'string' && actual.includes(expected)) {
        throw new Error(`Expected "${actual}" NOT to contain "${expected}"`);
      }
      if (Array.isArray(actual) && actual.includes(expected)) {
        throw new Error(`Expected array NOT to contain ${JSON.stringify(expected)}`);
      }
    }
  },
  
  toMatch: (regex) => {
    if (!regex.test(actual)) {
      throw new Error(`Expected "${actual}" to match ${regex}`);
    }
  },
  
  toHaveProperty: (prop) => {
    if (actual === null || actual === undefined || !(prop in actual)) {
      throw new Error(`Expected object to have property "${prop}"`);
    }
  },
  
  toBeInstanceOf: (type) => {
    if (!(actual instanceof type)) {
      throw new Error(`Expected instance of ${type.name}`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

export async function runTests() {
  let lastDescribe = '';
  
  for (const t of testQueue) {
    // Print describe header
    if (t.describe !== lastDescribe) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`📦 ${t.describe}`);
      console.log('═'.repeat(60));
      lastDescribe = t.describe;
    }
    
    // Skipped test
    if (t.skipped) {
      console.log(`  ⏭️  ${t.name} (skipped)`);
      results.skipped++;
      results.tests.push({ name: t.name, describe: t.describe, status: 'skipped' });
      continue;
    }
    
    // Run test
    const startTime = Date.now();
    try {
      await t.fn();
      const duration = Date.now() - startTime;
      console.log(`  ✅ ${t.name} (${duration}ms)`);
      results.passed++;
      results.tests.push({ name: t.name, describe: t.describe, status: 'passed', duration });
    } catch (err) {
      const duration = Date.now() - startTime;
      console.log(`  ❌ ${t.name} (${duration}ms)`);
      console.log(`     └─ ${err.message}`);
      results.failed++;
      results.tests.push({ name: t.name, describe: t.describe, status: 'failed', error: err.message, duration });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

export function printSummary() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed:  ${results.passed}`);
  console.log(`  ❌ Failed:  ${results.failed}`);
  console.log(`  ⏭️  Skipped: ${results.skipped}`);
  console.log(`  📝 Total:   ${results.tests.length}`);
  console.log('═'.repeat(60));
  
  if (results.failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => {
        console.log(`  • [${t.describe}] ${t.name}`);
        console.log(`    └─ ${t.error}`);
      });
  }
  
  const exitCode = results.failed > 0 ? 1 : 0;
  console.log(`\n${exitCode === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`);
  
  return { results, exitCode };
}

export function getResults() {
  return results;
}

export function getTestQueue() {
  return testQueue;
}

export default { describe, test, skip, expect, runTests, printSummary, getResults, getTestQueue };
