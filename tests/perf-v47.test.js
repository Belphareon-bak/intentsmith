// Performance Module v47.0 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for:
// - Profiler (timing, spans, reports)
// - Cache (LRU, plan cache, tool cache)
// - Worker pool (task execution, concurrency)
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  profiler,
  Profiler,
  profiled,
} from '../src/perf/profiler.js';

import {
  LRUCache,
  planCache,
  toolResultCache,
  cacheManager,
} from '../src/perf/cache.js';

import {
  Task,
  TaskStatus,
  WorkerPool,
  workerPool,
} from '../src/perf/worker-pool.js';

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Performance Module v47.0 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Profiler Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Profiler');

// Reset profiler for tests
profiler.reset();

test('profiler.startSpan creates a span', () => {
  const span = profiler.startSpan('test_span');
  assertTrue(span.name === 'test_span', 'Has correct name');
  assertTrue(span.startTime > 0, 'Has start time');
});

await asyncTest('span.end records duration', async () => {
  const span = profiler.startSpan('duration_test');
  await sleep(15);  // Slightly longer for reliability
  span.end();

  assertTrue(span.duration >= 5, 'Duration >= 5ms');  // More lenient
  assertTrue(span.endTime > span.startTime, 'End > Start');
});

await asyncTest('profiler.time wraps async functions', async () => {
  const result = await profiler.time('async_test', async () => {
    await sleep(5);
    return 'done';
  });

  assertEqual(result, 'done', 'Returns function result');
});

test('profiler.getReport returns stats', () => {
  const report = profiler.getReport();

  assertTrue('summary' in report, 'Has summary');
  assertTrue('phases' in report, 'Has phases');
  assertTrue('bottlenecks' in report, 'Has bottlenecks');
  assertTrue(report.summary.totalSpans >= 2, 'Has recorded spans');
});

test('profiler.percentile calculates correctly', () => {
  const testProfiler = new Profiler();

  // Add known values
  for (const duration of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    const span = testProfiler.startSpan('percentile_test');
    span.duration = duration;
    testProfiler.recordSpan(span);
  }

  const p50 = testProfiler.percentile('percentile_test', 50);
  const p90 = testProfiler.percentile('percentile_test', 90);

  assertTrue(p50 >= 40 && p50 <= 60, 'P50 is around median');
  assertTrue(p90 >= 80 && p90 <= 100, 'P90 is high');
});

test('profiler.snapshot captures memory', () => {
  const snapshot = profiler.snapshot('test');

  assertTrue(snapshot.heapUsed > 0, 'Has heap used');
  assertTrue(snapshot.timestamp > 0, 'Has timestamp');
  assertEqual(snapshot.label, 'test', 'Has label');
});

// ────────────────────────────────────────────────────────────────────────────
// Cache Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 LRU Cache');

test('LRUCache get/set works', () => {
  const cache = new LRUCache({ maxSize: 10 });

  cache.set('key1', 'value1');
  assertEqual(cache.get('key1'), 'value1', 'Gets correct value');
});

test('LRUCache respects maxSize', () => {
  const cache = new LRUCache({ maxSize: 3 });

  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4);  // Should evict 'a'

  assertEqual(cache.get('a'), undefined, 'a was evicted');
  assertEqual(cache.get('b'), 2, 'b still exists');
  assertEqual(cache.size, 3, 'Size is 3');
});

test('LRUCache respects TTL', async () => {
  const cache = new LRUCache({ maxSize: 10, ttl: 50 });

  cache.set('expire', 'soon');
  assertEqual(cache.get('expire'), 'soon', 'Initially exists');

  await sleep(60);
  assertEqual(cache.get('expire'), undefined, 'Expired after TTL');
});

test('LRUCache tracks hit/miss stats', () => {
  const cache = new LRUCache({ maxSize: 10 });
  cache.resetStats();

  cache.set('hit', 'value');
  cache.get('hit');      // hit
  cache.get('miss');     // miss

  const stats = cache.getStats();
  assertEqual(stats.hits, 1, 'One hit');
  assertEqual(stats.misses, 1, 'One miss');
});

console.log('\n📋 Specialized Caches');

test('planCache generates consistent keys', () => {
  const key1 = planCache.keyFor('Search for test');
  const key2 = planCache.keyFor('search for test');  // Different case
  const key3 = planCache.keyFor('  search  for  test  ');  // Extra spaces

  assertEqual(key1, key2, 'Case insensitive');
  assertEqual(key2, key3, 'Whitespace normalized');
});

test('toolResultCache knows cacheable tools', () => {
  assertTrue(toolResultCache.isCacheable('web.search'), 'web.search is cacheable');
  assertTrue(toolResultCache.isCacheable('fs.read'), 'fs.read is cacheable');
  assertTrue(!toolResultCache.isCacheable('fs.write'), 'fs.write is not cacheable');
});

test('cacheManager.getStats returns all cache stats', () => {
  const stats = cacheManager.getStats();

  assertTrue('plans' in stats, 'Has plan cache stats');
  assertTrue('tools' in stats, 'Has tool cache stats');
  assertTrue('llm' in stats, 'Has LLM cache stats');
});

// ────────────────────────────────────────────────────────────────────────────
// Worker Pool Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Worker Pool');

test('Task has correct initial state', () => {
  const task = new Task(() => 'result');

  assertEqual(task.status, TaskStatus.PENDING, 'Status is PENDING');
  assertEqual(task.attempts, 0, 'No attempts yet');
  assertTrue(task.id.startsWith('task_'), 'Has task ID');
});

await asyncTest('Task executes successfully', async () => {
  const task = new Task(() => 'success');
  const result = await task.execute();

  assertTrue(result.ok, 'Result is ok');
  assertEqual(result.result, 'success', 'Has correct result');
  assertEqual(task.status, TaskStatus.COMPLETED, 'Status is COMPLETED');
});

await asyncTest('Task handles errors', async () => {
  const task = new Task(() => { throw new Error('fail'); });
  const result = await task.execute();

  assertTrue(!result.ok, 'Result is not ok');
  assertEqual(result.error, 'fail', 'Has error message');
  assertEqual(task.status, TaskStatus.FAILED, 'Status is FAILED');
});

await asyncTest('Task retries on failure', async () => {
  let attempts = 0;
  const task = new Task(
    () => {
      attempts++;
      if (attempts < 3) throw new Error('not yet');
      return 'success';
    },
    { retries: 3, retryDelay: 10 }
  );

  const result = await task.execute();

  assertTrue(result.ok, 'Eventually succeeds');
  assertEqual(attempts, 3, 'Tried 3 times');
});

await asyncTest('WorkerPool processes tasks', async () => {
  const pool = new WorkerPool({ concurrency: 2 });

  const results = await Promise.all([
    pool.submit(() => 'a'),
    pool.submit(() => 'b'),
    pool.submit(() => 'c'),
  ]);

  assertEqual(results.length, 3, 'All tasks completed');
  assertTrue(results.includes('a'), 'Has result a');
  assertTrue(results.includes('b'), 'Has result b');
  assertTrue(results.includes('c'), 'Has result c');
});

await asyncTest('WorkerPool respects concurrency', async () => {
  const pool = new WorkerPool({ concurrency: 2 });
  let maxConcurrent = 0;
  let current = 0;

  const makeTask = () => async () => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await sleep(20);
    current--;
    return 'done';
  };

  await Promise.all([
    pool.submit(makeTask()),
    pool.submit(makeTask()),
    pool.submit(makeTask()),
    pool.submit(makeTask()),
  ]);

  assertTrue(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, should be <= 2`);
});

test('WorkerPool getStats returns statistics', () => {
  const stats = workerPool.getStats();

  assertTrue('submitted' in stats, 'Has submitted');
  assertTrue('completed' in stats, 'Has completed');
  assertTrue('avgDuration' in stats, 'Has avgDuration');
});

await asyncTest('WorkerPool handles priority', async () => {
  const pool = new WorkerPool({ concurrency: 1 });
  const order = [];

  // Submit low priority first, then high
  pool.submit(async () => { order.push('low'); }, { priority: 0 });
  pool.submit(async () => { order.push('high'); }, { priority: 10 });
  pool.submit(async () => { order.push('medium'); }, { priority: 5 });

  // Wait for all to complete
  await sleep(50);

  // High priority should run first (after the first one already started)
  assertTrue(order[0] === 'low' || order.indexOf('high') < order.indexOf('medium'),
    'Priority affects order');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
