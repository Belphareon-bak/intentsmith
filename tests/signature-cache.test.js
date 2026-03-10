// tests/signature-cache.test.js — Signature Map Cache v119 tests
import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  buildSignatureMap,
  formatSignatureMap,
  clearSignatureCache,
  getSignatureCacheSize,
} from '../src/code-intel/signature-map.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';

const TMP_DIR = '/tmp/sig-cache-test-' + Date.now();

// ─── Setup ──────────────────────────────────────────────────────────────────

async function setup() {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(path.join(TMP_DIR, 'a.js'), `
export function getUser(id) { return id; }
export const MAX_RETRIES = 3;
export class UserService {}
`);
  await writeFile(path.join(TMP_DIR, 'b.js'), `
export function processOrder(orderId) { return orderId; }
`);
  clearSignatureCache();
}

async function cleanup() {
  try {
    await rm(TMP_DIR, { recursive: true });
  } catch (_) {}
  clearSignatureCache();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

suite('clearSignatureCache');

await testAsync('clearSignatureCache resets size to 0', async () => {
  await setup();
  // Build signatures to populate cache
  await buildSignatureMap(['a.js'], TMP_DIR);
  assert(getSignatureCacheSize() > 0, 'Cache should have entries after build');
  clearSignatureCache();
  assertEqual(getSignatureCacheSize(), 0);
});

suite('Signature Cache — basic');

await testAsync('first call populates cache', async () => {
  await setup();
  clearSignatureCache();
  assertEqual(getSignatureCacheSize(), 0);
  await buildSignatureMap(['a.js'], TMP_DIR);
  assert(getSignatureCacheSize() > 0, 'Cache should have entries after first build');
});

await testAsync('second call uses cache (same result)', async () => {
  await setup();
  const result1 = await buildSignatureMap(['a.js'], TMP_DIR);
  const result2 = await buildSignatureMap(['a.js'], TMP_DIR);
  // Should produce identical results
  assertEqual(result1.length, result2.length);
  assertEqual(result1[0].exports.length, result2[0].exports.length);
  for (let i = 0; i < result1[0].exports.length; i++) {
    assertEqual(result1[0].exports[i], result2[0].exports[i]);
  }
});

await testAsync('cache miss on different content', async () => {
  await setup();
  await buildSignatureMap(['a.js'], TMP_DIR);
  const size1 = getSignatureCacheSize();

  // Modify file content
  await writeFile(path.join(TMP_DIR, 'a.js'), `
export function getUser(id) { return id; }
export function newFunction() { return 42; }
`);

  await buildSignatureMap(['a.js'], TMP_DIR);
  const size2 = getSignatureCacheSize();
  // Should have a new cache entry (different content hash)
  assert(size2 > size1, `Cache should grow: ${size2} > ${size1}`);
});

await testAsync('multiple files cached independently', async () => {
  await setup();
  await buildSignatureMap(['a.js', 'b.js'], TMP_DIR);
  const size = getSignatureCacheSize();
  assert(size >= 2, `Should cache at least 2 files, got ${size}`);
});

await testAsync('cache does not interfere with normal buildSignatureMap output', async () => {
  await setup();
  const result = await buildSignatureMap(['a.js', 'b.js'], TMP_DIR);
  assert(result.length === 2, `Should return 2 file entries, got ${result.length}`);

  // a.js should have getUser, MAX_RETRIES, UserService
  const aEntry = result.find(r => r.file === 'a.js');
  assert(aEntry, 'Should have entry for a.js');
  assert(aEntry.exports.length >= 2, `a.js should have >= 2 exports, got ${aEntry.exports.length}`);

  // b.js should have processOrder
  const bEntry = result.find(r => r.file === 'b.js');
  assert(bEntry, 'Should have entry for b.js');
  assert(bEntry.exports.length >= 1, `b.js should have >= 1 export, got ${bEntry.exports.length}`);
});

await testAsync('formatSignatureMap works with cached results', async () => {
  await setup();
  const result = await buildSignatureMap(['a.js'], TMP_DIR);
  const formatted = formatSignatureMap(result);
  assert(formatted.length > 0, 'Should produce non-empty formatted output');
  assert(formatted.includes('a.js'), 'Should mention the file');
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

await cleanup();

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
