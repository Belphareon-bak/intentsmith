// CRE v36.9.3 Memory Policy Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Store and recall by key
// - TTL expiration
// - Tag-based recall
// - Prefix-based recall (namespace)
// - Forget (explicit delete)
// - Max entries eviction
// - Tool integration: memory.store → memory.recall
//
// ══════════════════════════════════════════════════════════════════════════════

import { MemoryPolicy } from '../memory/policy.js';
import { toolExecutor } from '../tools/executor.js';
import { toolCall } from '../chat/cre-decision-types.js';

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
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v36.9.3 Memory Policy Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Store and Recall
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Store and Recall');

test('Store returns { stored: true, key }', () => {
  const mem = new MemoryPolicy();
  const result = mem.set('user.name', 'Jan');
  assertTrue(result.stored, 'Should confirm stored');
  assertEqual(result.key, 'user.name', 'Key');
});

test('Recall returns stored value', () => {
  const mem = new MemoryPolicy();
  mem.set('user.budget', 200000);
  const result = mem.get('user.budget');
  assertEqual(result.value, 200000, 'Value');
  assertEqual(result.meta.source, 'system', 'Default source');
});

test('Recall non-existent key returns NOT_FOUND', () => {
  const mem = new MemoryPolicy();
  const result = mem.get('nonexistent');
  assertEqual(result.code, 'NOT_FOUND', 'Error code');
});

test('Store with custom source and tags', () => {
  const mem = new MemoryPolicy();
  mem.set('session.lastQuery', 'auto 4x4', { source: 'tool', tags: ['search', 'auto'] });
  const result = mem.get('session.lastQuery');
  assertEqual(result.value, 'auto 4x4', 'Value');
  assertEqual(result.meta.source, 'tool', 'Source');
  assertTrue(result.meta.tags.includes('search'), 'Has search tag');
});

test('Store overwrites existing key', () => {
  const mem = new MemoryPolicy();
  mem.set('counter', 1);
  mem.set('counter', 2);
  assertEqual(mem.get('counter').value, 2, 'Should be overwritten');
});

// ────────────────────────────────────────────────────────────────────────────
// TTL
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 TTL Expiration');

test('TTL: non-expired key is accessible', () => {
  const mem = new MemoryPolicy();
  mem.set('temp', 'alive', { ttl: 60000 }); // 60s TTL
  const result = mem.get('temp');
  assertEqual(result.value, 'alive', 'Should be accessible');
});

test('TTL: expired key returns EXPIRED', () => {
  const mem = new MemoryPolicy();
  // Manually create an expired entry
  mem.store.set('old', {
    key: 'old', value: 'dead',
    storedAt: Date.now() - 10000,
    expiresAt: Date.now() - 5000, // Expired 5s ago
    source: 'test', tags: [], accessCount: 0, lastAccessedAt: null,
  });
  const result = mem.get('old');
  assertEqual(result.code, 'EXPIRED', 'Should be expired');
  assertTrue(!mem.has('old'), 'Should be removed');
});

test('TTL: has() returns false for expired keys', () => {
  const mem = new MemoryPolicy();
  mem.store.set('expired', {
    key: 'expired', value: 'x',
    storedAt: Date.now() - 10000,
    expiresAt: Date.now() - 1000,
    source: 'test', tags: [], accessCount: 0, lastAccessedAt: null,
  });
  assertTrue(!mem.has('expired'), 'has() should return false for expired');
});

// ────────────────────────────────────────────────────────────────────────────
// Tag-based recall
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Tag-based Recall');

test('getByTag returns all matching entries', () => {
  const mem = new MemoryPolicy();
  mem.set('car1', { name: 'Jimny', price: 189000 }, { tags: ['search-result', 'auto'] });
  mem.set('car2', { name: 'Duster', price: 175000 }, { tags: ['search-result', 'auto'] });
  mem.set('other', 'unrelated', { tags: ['misc'] });

  const results = mem.getByTag('search-result');
  assertEqual(results.length, 2, 'Should find 2 tagged entries');
  assertTrue(results.some(r => r.key === 'car1'), 'Should include car1');
  assertTrue(results.some(r => r.key === 'car2'), 'Should include car2');
});

test('getByTag returns empty for unknown tag', () => {
  const mem = new MemoryPolicy();
  mem.set('a', 1, { tags: ['x'] });
  assertEqual(mem.getByTag('unknown').length, 0, 'Should be empty');
});

// ────────────────────────────────────────────────────────────────────────────
// Prefix-based recall (namespace)
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Prefix Recall');

test('getByPrefix returns all matching keys', () => {
  const mem = new MemoryPolicy();
  mem.set('user.name', 'Jan');
  mem.set('user.budget', 200000);
  mem.set('user.preference', '4x4');
  mem.set('session.id', 'abc123');

  const userFacts = mem.getByPrefix('user.');
  assertEqual(userFacts.length, 3, 'Should find 3 user.* entries');
  assertTrue(userFacts.some(r => r.key === 'user.budget'), 'Should include user.budget');
});

// ────────────────────────────────────────────────────────────────────────────
// Forget
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Forget');

test('forget removes a key', () => {
  const mem = new MemoryPolicy();
  mem.set('temp', 'to-delete');
  assertTrue(mem.has('temp'), 'Should exist before');
  const result = mem.forget('temp');
  assertTrue(result.deleted, 'Should confirm deletion');
  assertTrue(!mem.has('temp'), 'Should not exist after');
});

test('forget non-existent key returns deleted: false', () => {
  const mem = new MemoryPolicy();
  const result = mem.forget('nonexistent');
  assertTrue(!result.deleted, 'Should not confirm deletion');
});

test('forget with reason records the reason', () => {
  const mem = new MemoryPolicy();
  mem.set('bad.fact', 'wrong value');
  const result = mem.forget('bad.fact', 'user_correction');
  assertTrue(result.deleted, 'Should delete');
  assertEqual(result.reason, 'user_correction', 'Should record reason');
});

test('forget without reason returns undefined reason', () => {
  const mem = new MemoryPolicy();
  mem.set('temp', 'x');
  const result = mem.forget('temp');
  assertTrue(result.deleted, 'Should delete');
  assertEqual(result.reason, undefined, 'No reason = undefined');
});

// ────────────────────────────────────────────────────────────────────────────
// Max entries eviction
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Eviction');

test('Evicts oldest when at maxEntries', () => {
  const mem = new MemoryPolicy({ maxEntries: 3 });
  mem.set('a', 1);
  mem.set('b', 2);
  mem.set('c', 3);
  // This should evict 'a' (oldest)
  mem.set('d', 4);
  assertTrue(!mem.has('a'), 'Oldest should be evicted');
  assertTrue(mem.has('d'), 'Newest should exist');
  assertEqual(mem.store.size, 3, 'Should not exceed maxEntries');
});

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Stats');

test('getStats returns entry count and breakdowns', () => {
  const mem = new MemoryPolicy();
  mem.set('a', 1, { source: 'user', tags: ['tag1'] });
  mem.set('b', 2, { source: 'tool', tags: ['tag1', 'tag2'] });
  mem.set('c', 3, { source: 'user' });

  const stats = mem.getStats();
  assertEqual(stats.entries, 3, 'Entry count');
  assertEqual(stats.bySource.user, 2, 'User source count');
  assertEqual(stats.bySource.tool, 1, 'Tool source count');
  assertEqual(stats.byTag.tag1, 2, 'tag1 count');
  assertEqual(stats.byTag.tag2, 1, 'tag2 count');
});

// ────────────────────────────────────────────────────────────────────────────
// Tool Integration: memory.store → memory.recall
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Tool Integration');

await asyncTest('memory.store via ToolExecutor stores a fact', async () => {
  const decision = toolCall('memory.store', {
    key: 'user.budget',
    value: '200000',
    source: 'user',
    tags: ['preference'],
  });
  const result = await toolExecutor.executeDecision(decision);
  assertTrue(result.ok, 'Should succeed');
  assertTrue(result.data.stored, 'Should confirm stored');
});

await asyncTest('memory.recall via ToolExecutor retrieves stored fact', async () => {
  const decision = toolCall('memory.recall', { key: 'user.budget' });
  const result = await toolExecutor.executeDecision(decision);
  assertTrue(result.ok, 'Should succeed');
  assertEqual(result.data.value, '200000', 'Should recall stored value');
});

await asyncTest('memory.recall by tag works via ToolExecutor', async () => {
  const decision = toolCall('memory.recall', { key: '_', tag: 'preference' });
  const result = await toolExecutor.executeDecision(decision);
  assertTrue(result.ok, 'Should succeed');
  assertTrue(result.data.results.length > 0, 'Should find tagged entries');
});

await asyncTest('Stop-condition: store → recall round-trip', async () => {
  // Store
  await toolExecutor.executeDecision(
    toolCall('memory.store', { key: 'test.roundtrip', value: { x: 42 }, tags: ['test'] })
  );
  // Recall
  const result = await toolExecutor.executeDecision(
    toolCall('memory.recall', { key: 'test.roundtrip' })
  );
  assertTrue(result.ok, 'Should succeed');
  assertEqual(result.data.value.x, 42, 'Should recall object value');
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
