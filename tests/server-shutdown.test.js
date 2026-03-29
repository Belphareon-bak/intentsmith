import { strict as assert } from 'assert';
import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

console.log('\n🛑 Server Shutdown');

const serverCode = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const shutdownStart = serverCode.indexOf('function gracefulShutdown');
const shutdownEnd = serverCode.indexOf("process.on('SIGINT'", shutdownStart);
const shutdownBlock = shutdownStart >= 0 && shutdownEnd > shutdownStart
  ? serverCode.slice(shutdownStart, shutdownEnd)
  : '';

test('T1: gracefulShutdown flushes metrics before closing the DB', () => {
  assert.ok(shutdownBlock.includes('metricsCollector?.flush()'), 'expected metricsCollector?.flush() in gracefulShutdown');
  assert.ok(shutdownBlock.includes('db.close()'), 'expected db.close() in gracefulShutdown');
  assert.ok(
    shutdownBlock.indexOf('metricsCollector?.flush()') < shutdownBlock.indexOf('db.close()'),
    'metricsCollector?.flush() should happen before db.close()'
  );
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Server Shutdown Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
