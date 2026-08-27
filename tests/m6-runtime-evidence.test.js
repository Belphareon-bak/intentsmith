import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  M6_PREVIOUS_VERSION_SHA,
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  M6_RUNTIME_EVIDENCE_MARKER,
} from '../contracts/m6/runtime-evidence-v1.js';
import { validateM6RuntimeEvidence } from '../src/release/m6-runtime-evidence.js';
import { suite, summary, test } from './harness.js';

const candidateSha = 'a'.repeat(40);

function receipt(overrides = {}) {
  return {
    contract: 'M6PreviousVersionUpgradeReceipt',
    version: 1,
    candidateSha,
    previousSha: M6_PREVIOUS_VERSION_SHA,
    previousVersion: '136.0.0',
    currentVersion: '136.1.0',
    databaseIdentitySha256: 'b'.repeat(64),
    previousMigrationCount: 56,
    currentMigrationCount: 78,
    canary: { id: 1, name: 'M6 Upgrade Canary', survivedUpgrade: true },
    previousServerCleanShutdown: true,
    currentServerCleanShutdown: true,
    networkScope: 'loopback-only',
    verdict: 'PASS',
    ...overrides,
  };
}

function log(value = receipt()) {
  return `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(value)).toString('base64url')}\n`;
}

suite('M6 runtime evidence receipts');

test('exact previous-version application receipt passes', () => {
  const result = validateM6RuntimeEvidence(
    M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
    log(),
    { candidateSha },
  );
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.receipt.canary.survivedUpgrade, true);
});

test('missing, duplicate, rebound and weaker upgrade receipts fail closed', () => {
  for (const bytes of [
    '',
    `${log()}${log()}`,
    log(receipt({ candidateSha: 'c'.repeat(40) })),
    log(receipt({ currentMigrationCount: 56 })),
    log(receipt({ previousServerCleanShutdown: false })),
    log(receipt({ networkScope: 'external' })),
  ]) {
    assert.equal(validateM6RuntimeEvidence(
      M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
      bytes,
      { candidateSha },
    ).valid, false);
  }
});

summary();
