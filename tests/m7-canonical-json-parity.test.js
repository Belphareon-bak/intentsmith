#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalizeM7SessionValue } from '../src/remote/m7-session-authority-validation.js';

const VECTOR_PATH = fileURLToPath(
  new URL('../contracts/m7/canonical-json-vectors-v1.json', import.meta.url),
);
const vectorSet = JSON.parse(readFileSync(VECTOR_PATH, 'utf8'));
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ❌ ${name}: ${error.stack || error.message}`);
  }
}

await test('the shared vector set has an exact versioned shape', () => {
  assert.deepEqual(Object.keys(vectorSet).sort(), ['contract', 'vectors', 'version']);
  assert.equal(vectorSet.contract, 'M7CanonicalJsonVectorSet');
  assert.equal(vectorSet.version, 1);
  assert.equal(Array.isArray(vectorSet.vectors), true);
  assert.equal(vectorSet.vectors.length >= 9, true);
  assert.equal(new Set(vectorSet.vectors.map(vector => vector.id)).size, vectorSet.vectors.length);
});

for (const vector of vectorSet.vectors) {
  await test(`Node canonicalization matches shared vector ${vector.id}`, () => {
    assert.deepEqual(
      Object.keys(vector).sort(),
      ['canonicalBase64', 'id', 'input', 'valid'],
    );
    if (!vector.valid) {
      assert.equal(vector.canonicalBase64, null);
      assert.throws(() => canonicalizeM7SessionValue(vector.input));
      return;
    }
    const canonical = canonicalizeM7SessionValue(vector.input);
    assert.equal(
      Buffer.from(canonical, 'utf8').toString('base64'),
      vector.canonicalBase64,
    );
  });
}

await test('negative zero remains invalid outside the JSON transport corpus', () => {
  assert.throws(() => canonicalizeM7SessionValue({ value: -0 }));
});

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
