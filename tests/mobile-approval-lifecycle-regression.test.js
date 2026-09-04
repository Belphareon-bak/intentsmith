// WP-MOBILE-019 — approval lifecycle composition regression
// =============================================================================
//
// The detailed adversarial cases live beside the MS-13/MS-14 surfaces they
// exercise.  This composition test makes those named cases mandatory together
// and guards the one implementation shortcut this package is forbidden to take:
// persisting approval identity or payload into the frozen MD-19 journal shape.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function runSuite(file, requiredNames) {
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, C3_LOG_LEVEL: 'error' },
  });
  assert.equal(result.error, undefined, `${file} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0,
    `${file} exited ${result.status}\n${result.stdout || ''}${result.stderr || ''}`);
  for (const name of requiredNames) {
    assert.match(result.stdout, new RegExp(`✓ ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${file} no longer executes required regression ${name}`);
  }
}

console.log('\n=== WP-MOBILE-019 approval lifecycle composition ===');

test('MS-13 publishes no stale approval surface and uses cache:no-store', () => {
  runSuite('tests/mobile-ms13-approvals.test.js', [
    'F-077 revalidation withdraws prior rows and the drawer badge before the answer',
    'F-078 offline invalidation removes approval-derived notes as well as rows',
    'F-079 local read-scope loss clears the queue, notes and badge without asking the server',
    'F-080 approval reads explicitly bypass the browser HTTP cache',
  ]);
});

test('MS-14 closes route, restart, attribution, envelope and visibility gaps', () => {
  runSuite('tests/mobile-ms14-decision.test.js', [
    'F-089 new-chat exit revokes authority and direct submission stays fail-closed',
    'F-090 cold restart blocks every new decision while an unassociated approval key is open',
    'F-091 a confirmed MS-20 lookup preserves own attribution after volatile state is gone',
    'F-092 a contradictory fresh decision envelope remains UNKNOWN',
    'F-093 foreground reconciles and refreshes without restoring decision authority',
    'F-094 operation-conflict cancellation depends on the direct decision guard',
    'F-094 an unrelated server failure depends on the connection guard',
  ]);
});

test('MS-20 recovery remains green after approval lifecycle repair', () => {
  runSuite('tests/mobile-ms20-ui.test.js', [
    'F-038 a lookup that resolves releases the row and the cap even if the refresh fails',
    'F-039 startup reconciliation only reads: no send, no silent abandon',
    'F-040 only ok:true with data.known:false means the server does not hold the key',
    'F-041 a lookup merges the new state, reason and check time into the row at once',
  ]);
});

test('F-090 repair does not widen the frozen persisted journal entry', () => {
  const source = readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8');
  const decision = source.slice(source.indexOf('async function decideApproval'));
  const add = decision.match(/journal\.add\(\{([\s\S]*?)\}\);/);
  assert.ok(add, 'the approval decision no longer writes its recovery record before dispatch');
  assert.doesNotMatch(add[1], /\bapprovalId\b/, 'approvalId was persisted into MD-19');
  assert.doesNotMatch(add[1], /\bpayloadFingerprint\b/, 'the approval payload fingerprint was persisted into MD-19');
});

console.log(`\nApproval lifecycle composition: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
