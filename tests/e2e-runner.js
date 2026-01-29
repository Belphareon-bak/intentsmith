// ═══════════════════════════════════════════════════════════════════════════════
// E2E Test Runner
// ═══════════════════════════════════════════════════════════════════════════════
//
// Simple test runner providing describe/test/expect pattern
// Used by legacy test files (cre-v2.test.js, cre-decision-types.test.js)
//
// ═══════════════════════════════════════════════════════════════════════════════

const testSuites = [];
let currentSuite = null;

const stats = {
  passed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  failures: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Definition API
// ─────────────────────────────────────────────────────────────────────────────

export function describe(name, fn) {
  currentSuite = { name, tests: [] };
  fn();
  testSuites.push(currentSuite);
  currentSuite = null;
}

export function test(name, fn) {
  if (!currentSuite) {
    throw new Error('test() must be called inside describe()');
  }
  currentSuite.tests.push({ name, fn });
}

// Alias
export const it = test;

// ─────────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────────

export function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new AssertionError(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },

    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new AssertionError(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },

    toBeGreaterThan(expected) {
      if (!(actual > expected)) {
        throw new AssertionError(`Expected ${actual} > ${expected}`);
      }
    },

    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) {
        throw new AssertionError(`Expected ${actual} >= ${expected}`);
      }
    },

    toBeLessThan(expected) {
      if (!(actual < expected)) {
        throw new AssertionError(`Expected ${actual} < ${expected}`);
      }
    },

    toBeLessThanOrEqual(expected) {
      if (!(actual <= expected)) {
        throw new AssertionError(`Expected ${actual} <= ${expected}`);
      }
    },

    toBeDefined() {
      if (actual === undefined) {
        throw new AssertionError(`Expected value to be defined, got undefined`);
      }
    },

    toBeUndefined() {
      if (actual !== undefined) {
        throw new AssertionError(`Expected undefined, got ${JSON.stringify(actual)}`);
      }
    },

    toBeNull() {
      if (actual !== null) {
        throw new AssertionError(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },

    toBeTruthy() {
      if (!actual) {
        throw new AssertionError(`Expected truthy value, got ${JSON.stringify(actual)}`);
      }
    },

    toBeFalsy() {
      if (actual) {
        throw new AssertionError(`Expected falsy value, got ${JSON.stringify(actual)}`);
      }
    },

    toContain(expected) {
      const contains = Array.isArray(actual)
        ? actual.includes(expected)
        : typeof actual === 'string' && actual.includes(expected);

      if (!contains) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      }
    },

    toMatch(pattern) {
      if (!pattern.test(actual)) {
        throw new AssertionError(`Expected "${actual}" to match ${pattern}`);
      }
    },

    toThrow(expectedMessage) {
      if (typeof actual !== 'function') {
        throw new AssertionError('toThrow() expects a function');
      }

      let threw = false;
      let thrownError = null;

      try {
        actual();
      } catch (e) {
        threw = true;
        thrownError = e;
      }

      if (!threw) {
        throw new AssertionError('Expected function to throw');
      }

      if (expectedMessage && !thrownError.message.includes(expectedMessage)) {
        throw new AssertionError(`Expected error message to include "${expectedMessage}", got "${thrownError.message}"`);
      }
    },

    not: {
      toBe(expected) {
        if (actual === expected) {
          throw new AssertionError(`Expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`);
        }
      },

      toEqual(expected) {
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
          throw new AssertionError(`Expected values not to be equal`);
        }
      },

      toBeNull() {
        if (actual === null) {
          throw new AssertionError(`Expected value not to be null`);
        }
      },

      toBeDefined() {
        if (actual !== undefined) {
          throw new AssertionError(`Expected value to be undefined`);
        }
      },

      toContain(expected) {
        const contains = Array.isArray(actual)
          ? actual.includes(expected)
          : typeof actual === 'string' && actual.includes(expected);

        if (contains) {
          throw new AssertionError(`Expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`);
        }
      },
    },
  };
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────

export async function runTests() {
  for (const suite of testSuites) {
    console.log(`\n${suite.name}`);

    for (const test of suite.tests) {
      stats.total++;

      try {
        const result = test.fn();

        // Handle async tests
        if (result && typeof result.then === 'function') {
          await result;
        }

        stats.passed++;
        console.log(`  ✓ ${test.name}`);
      } catch (err) {
        stats.failed++;
        stats.failures.push({
          suite: suite.name,
          test: test.name,
          error: err.message,
        });
        console.log(`  ✗ ${test.name}`);
        console.log(`    ${err.message}`);
      }
    }
  }
}

export function printSummary() {
  console.log('\n' + '━'.repeat(60));
  console.log(`Tests: ${stats.passed} passed, ${stats.failed} failed, ${stats.total} total`);

  if (stats.failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of stats.failures) {
      console.log(`  - ${f.suite} > ${f.test}`);
      console.log(`    ${f.error}`);
    }
  }

  return {
    ...stats,
    exitCode: stats.failed > 0 ? 1 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  describe,
  test,
  it,
  expect,
  runTests,
  printSummary,
};
