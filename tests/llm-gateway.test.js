// CRE v36.7 LLM Gateway Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for capability-based LLM authorization
//
// ══════════════════════════════════════════════════════════════════════════════

import { llmGateway, callWithAuth, legacyCall } from '../src/llm/gateway.js';
import { 
  createAuthToken, 
  validateAuthToken, 
  hasCapability,
  LLMCallerRole,
  LLMCapability
} from '../src/llm/auth-types.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function assertThrows(fn, msg = '') {
  try {
    fn();
    throw new Error(`${msg}: Expected function to throw`);
  } catch (e) {
    if (e.message.includes('Expected function to throw')) throw e;
    // Expected - function threw
  }
}

async function assertThrowsAsync(fn, msg = '') {
  try {
    await fn();
    throw new Error(`${msg}: Expected function to throw`);
  } catch (e) {
    if (e.message.includes('Expected function to throw')) throw e;
    // Expected - function threw
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: AUTH TOKEN CREATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🔑 AUTH TOKEN CREATION');
console.log('════════════════════════════════════════════════════════════');

test('createAuthToken with valid params', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  assertEqual(token.role, 'CRE_DECISION');
  assertEqual(token.decisionId, 'test-123');
  assertEqual(token.auditContext.sessionId, 'session-456');
  assertTrue(token.maxTokens > 0);
  assertTrue(token.allowedCapabilities.length > 0);
  assertTrue(token.issuedAt <= Date.now());
  assertTrue(token.expiresAt > Date.now());
});

test('createAuthToken throws on invalid role', () => {
  assertThrows(() => {
    createAuthToken({
      role: 'INVALID_ROLE',
      decisionId: 'test-123',
      auditContext: { sessionId: 'session-456' }
    });
  }, 'Should throw on invalid role');
});

test('createAuthToken throws on missing decisionId', () => {
  assertThrows(() => {
    createAuthToken({
      role: 'CRE_DECISION',
      auditContext: { sessionId: 'session-456' }
    });
  }, 'Should throw on missing decisionId');
});

test('createAuthToken throws on missing sessionId', () => {
  assertThrows(() => {
    createAuthToken({
      role: 'CRE_DECISION',
      decisionId: 'test-123',
      auditContext: {}
    });
  }, 'Should throw on missing sessionId');
});

test('createAuthToken allows custom maxTokens', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' },
    maxTokens: 500
  });
  
  assertEqual(token.maxTokens, 500);
});

test('createAuthToken allows custom capabilities', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' },
    capabilities: ['reasoning', 'summarization']
  });
  
  assertEqual(token.allowedCapabilities.length, 2);
  assertTrue(token.allowedCapabilities.includes('reasoning'));
  assertTrue(token.allowedCapabilities.includes('summarization'));
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: TOKEN VALIDATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('✔️  TOKEN VALIDATION');
console.log('════════════════════════════════════════════════════════════');

test('validateAuthToken passes valid token', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  const result = validateAuthToken(token);
  assertTrue(result.valid);
});

test('validateAuthToken fails on null token', () => {
  const result = validateAuthToken(null);
  assertFalse(result.valid);
  assertEqual(result.error, 'NO_TOKEN');
});

test('validateAuthToken fails on missing role', () => {
  const result = validateAuthToken({ decisionId: 'test' });
  assertFalse(result.valid);
  assertEqual(result.error, 'MISSING_ROLE');
});

test('validateAuthToken fails on missing decisionId', () => {
  const result = validateAuthToken({ role: 'CRE_DECISION' });
  assertFalse(result.valid);
  assertEqual(result.error, 'MISSING_DECISION_ID');
});

test('validateAuthToken fails on expired token', () => {
  const token = {
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    expiresAt: Date.now() - 1000  // Expired 1 second ago
  };
  
  const result = validateAuthToken(token);
  assertFalse(result.valid);
  assertEqual(result.error, 'TOKEN_EXPIRED');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: CAPABILITY CHECKING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🎯 CAPABILITY CHECKING');
console.log('════════════════════════════════════════════════════════════');

test('hasCapability returns true for allowed capability', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  assertTrue(hasCapability(token, LLMCapability.REASONING));
});

test('hasCapability returns false for disallowed capability', () => {
  const token = createAuthToken({
    role: 'TOOL_INTERNAL',  // Limited capabilities
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  assertFalse(hasCapability(token, LLMCapability.CODE_GENERATION));
});

test('hasCapability returns false for null token', () => {
  assertFalse(hasCapability(null, LLMCapability.REASONING));
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: GATEWAY AUTHORIZATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🚪 GATEWAY AUTHORIZATION');
console.log('════════════════════════════════════════════════════════════');

test('llmGateway starts unauthorized', () => {
  llmGateway.revoke();  // Ensure clean state
  assertFalse(llmGateway.isAuthorized());
});

test('llmGateway.authorize makes gateway authorized', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  llmGateway.authorize(token);
  assertTrue(llmGateway.isAuthorized());
  
  llmGateway.revoke();
});

test('llmGateway.revoke makes gateway unauthorized', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  llmGateway.authorize(token);
  assertTrue(llmGateway.isAuthorized());
  
  llmGateway.revoke();
  assertFalse(llmGateway.isAuthorized());
});

test('llmGateway.authorize throws on invalid token', () => {
  assertThrows(() => {
    llmGateway.authorize({ invalid: true });
  }, 'Should throw on invalid token');
});

test('llmGateway.getCurrentAuth returns auth info when authorized', () => {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  llmGateway.authorize(token);
  const auth = llmGateway.getCurrentAuth();
  
  assertEqual(auth.role, 'CRE_DECISION');
  assertEqual(auth.decisionId, 'test-123');
  assertTrue(auth.expiresIn > 0);
  
  llmGateway.revoke();
});

test('llmGateway.getCurrentAuth returns null when unauthorized', () => {
  llmGateway.revoke();
  assertEqual(llmGateway.getCurrentAuth(), null);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: STRICT MODE
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🔒 STRICT MODE');
console.log('════════════════════════════════════════════════════════════');

test('llmGateway.enableStrictMode sets strict mode', () => {
  llmGateway.enableStrictMode();
  
  const stats = llmGateway.getStats();
  assertTrue(stats.strictMode);
  
  llmGateway.disableStrictMode();
});

test('llmGateway.disableStrictMode disables strict mode', () => {
  llmGateway.enableStrictMode();
  llmGateway.disableStrictMode();
  
  const stats = llmGateway.getStats();
  assertFalse(stats.strictMode);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: RATE LIMITING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('⏱️  RATE LIMITING');
console.log('════════════════════════════════════════════════════════════');

test('checkRateLimit allows calls under limit', () => {
  const result = llmGateway.checkRateLimit();
  assertTrue(result.allowed);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 7: AUDIT LOGGING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📋 AUDIT LOGGING');
console.log('════════════════════════════════════════════════════════════');

test('getStats returns statistics', () => {
  const stats = llmGateway.getStats();
  
  assertTrue('totalCalls' in stats);
  assertTrue('recentCalls' in stats);
  assertTrue('unauthorizedAttempts' in stats);
  assertTrue('byRole' in stats);
  assertTrue('strictMode' in stats);
});

test('getAuditLogs returns array', () => {
  const logs = llmGateway.getAuditLogs();
  assertTrue(Array.isArray(logs));
});

test('authorization creates audit log entry', () => {
  const beforeCount = llmGateway.getAuditLogs().length;
  
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: 'audit-test-123',
    auditContext: { sessionId: 'session-456' }
  });
  
  llmGateway.authorize(token);
  llmGateway.revoke();
  
  const afterCount = llmGateway.getAuditLogs().length;
  assertTrue(afterCount > beforeCount, 'Should have more audit logs');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 8: ROLE DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('👤 ROLE DEFAULTS');
console.log('════════════════════════════════════════════════════════════');

const allRoles = Object.keys(LLMCallerRole);

for (const role of allRoles) {
  test(`Role ${role} has default capabilities`, () => {
    const token = createAuthToken({
      role,
      decisionId: `test-${role}`,
      auditContext: { sessionId: 'session-456' }
    });
    
    assertTrue(token.allowedCapabilities.length > 0, `Role ${role} should have capabilities`);
  });
}

for (const role of allRoles) {
  test(`Role ${role} has default token limit`, () => {
    const token = createAuthToken({
      role,
      decisionId: `test-${role}`,
      auditContext: { sessionId: 'session-456' }
    });
    
    assertTrue(token.maxTokens > 0, `Role ${role} should have token limit`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 LLM GATEWAY TEST SUMMARY');
console.log('════════════════════════════════════════════════════════════');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`  ✅ Passed:  ${passed}`);
console.log(`  ❌ Failed:  ${failed}`);

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('\n✅ ALL LLM GATEWAY TESTS PASSED');
}
