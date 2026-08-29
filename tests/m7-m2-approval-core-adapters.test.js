#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import { MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 } from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { up as installEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as installEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as installEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as installEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as installExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as installLifecycleAuthority } from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import {
  EXPECTED_M7_M2_APPROVAL_LIST_INDEX_FINGERPRINT_V106,
  computeM7M2ApprovalListIndexFingerprintV106,
  up as installApprovalIndex,
} from '../src/db/migrations/2026_08_29_106_m7_m2_approval_list_index.js';
import {
  createDefaultM2LifecycleApplicationService,
  createM2LifecycleApprovalPort,
} from '../src/lifecycle/m2-lifecycle-application-service.js';
import { createM7InProcessCapabilityProvider } from '../src/remote/m7-in-process-capability-provider.js';
import { createM7M2ApprovalCoreAdapters } from '../src/remote/m7-m2-approval-core-adapters.js';
import { createM7OperationJournal } from '../src/remote/m7-operation-journal.js';
import { suite, summary, test, testAsync } from './harness.js';

const PROJECT_ID = 27;
const SUBJECT_ID = 'operator-m2';
const DEVICE_ID = 'device:m7-approval:001';
const CURSOR_KEY = Buffer.alloc(32, 0x61);
const ORIGIN = Object.freeze({
  surface: 'studio',
  sessionId: 'studio-session-m2',
  conversationId: 'studio-conversation-m2',
  projectId: PROJECT_ID,
});

function git(root, args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: root,
    env: {
      PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    },
    encoding: 'utf8',
  }).trim();
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m7-m2-approval-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.c3'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, '.c3', 'm2-governance-policy.json'), `${JSON.stringify({
    policyId: 'm2-policy-v1',
    layers: [{ name: 'app', roots: ['src'] }],
    rules: [{ from: 'app', canImport: ['app'] }],
    externalImports: [],
    sourceExtensions: ['.js'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'],
    unmappedFilePolicy: 'unavailable',
  }, null, 2)}\n`);
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', '.c3/m2-governance-policy.json', 'src/app.js']);
  git(root, [
    '-c', 'user.name=IntentSmith Test', '-c', 'user.email=intentsmith@example.invalid',
    'commit', '-m', 'baseline',
  ]);
  return root;
}

function setup() {
  const root = makeProject();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of [
    installEffectAuthority, installEffectHardening, installEffectClaims,
    installEffectClaimTruth, installExecutionAuthority, installLifecycleAuthority,
    installJournal, installAbandonments, installApprovalIndex,
  ]) migration(db);
  let nowMs = Date.parse('2026-08-29T20:00:00.000Z');
  const clock = () => ++nowMs;
  const service = createDefaultM2LifecycleApplicationService({
    database: db,
    projects: Object.freeze({
      findById: Object.freeze({
        get(projectId) {
          return projectId === PROJECT_ID ? { id: PROJECT_ID, path: root, status: 'active' } : null;
        },
      }),
    }),
    clock,
  });
  const approvalPort = createM2LifecycleApprovalPort(service);
  const adapters = createM7M2ApprovalCoreAdapters({ approvalPort, cursorKey: CURSOR_KEY, now: clock });
  const journal = createM7OperationJournal(db, { clock });
  const provider = createM7InProcessCapabilityProvider({
    authorityResolver: async input => ({
      decision: 'allow', deviceId: DEVICE_ID, subjectId: SUBJECT_ID,
      grantedScopes: [...input.requiredScopes],
    }),
    controlPlaneManifest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
    handlers: adapters.handlers,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    mutationJournal: journal,
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    validateOperationPair: validateMobileRemoteOperationPair,
    validatePayload: validateMobileRemotePayload,
  });
  return {
    adapters, approvalPort, clock, db, provider, root, service,
    close() {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function prepare(fixture, afterContent = 'export const value = 2;\n') {
  await fixture.service.recoverIncompleteSmallProjectChanges();
  return fixture.service.prepareSmallProjectChange({
    authenticatedSubject: { actorType: 'user', actorId: SUBJECT_ID },
    projectId: PROJECT_ID,
    origin: ORIGIN,
    proposal: {
      intent: 'Update the exact application value',
      changes: [{ path: 'src/app.js', afterContent }],
      focusedTest: {
        binary: '/usr/bin/node', argv: ['--version'],
        environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' },
        timeoutMs: 30_000,
      },
    },
  });
}

function invoke(provider, operationId, request) {
  return provider.invoke({
    capabilityId: 'approvals', capabilityVersion: 1, operationId, request,
  });
}

function listRequest(overrides = {}) {
  return {
    contract: 'ApprovalListQuery', version: 1,
    requestId: 'request:m7:approval:list', limit: 25, states: ['pending'],
    ...overrides,
  };
}

function decisionRequest(item, decision, operationId) {
  return {
    contract: 'ApprovalDecisionCommand', version: 1,
    requestId: `request:${operationId}`,
    operationId,
    approvalId: item.approvalId,
    decision,
    expectedPayloadFingerprint: item.payloadFingerprint,
    expectedViewDigest: item.approvalViewDigest,
    expectedRevision: item.revision,
  };
}

suite('M7 M2-only approval core adapters');

test('only a closure-branded genuine M2 lifecycle approval port is accepted', () => {
  assert.throws(
    () => createM7M2ApprovalCoreAdapters({
      approvalPort: {
        contract: 'M2LifecycleApprovalPort', version: 1,
        listOwned() { return []; },
      },
      cursorKey: CURSOR_KEY,
    }),
    /genuine-m2-port-required/u,
  );
});

await testAsync('pending M2 plan is projected without content and exact approve crosses the accepted authority', async () => {
  const fixture = setup();
  try {
    const planned = await prepare(fixture);
    assert.equal(
      computeM7M2ApprovalListIndexFingerprintV106(fixture.db),
      EXPECTED_M7_M2_APPROVAL_LIST_INDEX_FINGERPRINT_V106,
    );
    const queryPlan = fixture.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT lifecycle_id, created_at_ms FROM m2_lifecycle_operations
      WHERE json_extract(plan_json, '$.actor.id') = ?
      ORDER BY created_at_ms DESC, lifecycle_id DESC LIMIT ?
    `).all(SUBJECT_ID, 2_001).map(row => row.detail).join('\n');
    assert.match(queryPlan, /idx_m2_lifecycle_remote_approval_owner_list/u);

    const advertisement = fixture.provider.advertise();
    assert.equal(advertisement.find(item => item.capabilityId === 'approvals').status, 'available');
    const page = await invoke(fixture.provider, 'approval.list', listRequest());
    assert.equal(validateMobileRemotePayload('ApprovalPage@1', page).valid, true);
    assert.equal(page.items.length, 1);
    const item = page.items[0];
    assert.equal(item.approvalId, planned.lifecycleId);
    assert.equal(item.payloadFingerprint, planned.planDigest);
    assert.equal(JSON.stringify(item).includes('export const value'), false);

    const stale = decisionRequest(item, 'approve', 'operation:m7:approval:stale');
    stale.expectedViewDigest = `sha256:${'0'.repeat(64)}`;
    const rejected = await invoke(fixture.provider, 'approval.decide', stale);
    assert.equal(validateMobileRemotePayload('ApprovalDecisionResult@1', rejected).valid, true);
    assert.equal(rejected.outcome, 'REJECTED');
    assert.equal(rejected.error.code, 'REMOTE_APPROVAL_VIEW_STALE');
    assert.equal(fs.readFileSync(path.join(fixture.root, 'src', 'app.js'), 'utf8'), 'export const value = 1;\n');

    const command = decisionRequest(item, 'approve', 'operation:m7:approval:approve');
    const confirmed = await invoke(fixture.provider, 'approval.decide', command);
    assert.equal(validateMobileRemotePayload('ApprovalDecisionResult@1', confirmed).valid, true);
    assert.equal(confirmed.outcome, 'CONFIRMED');
    assert.equal(confirmed.approvalState, 'approved');
    assert.equal(fs.readFileSync(path.join(fixture.root, 'src', 'app.js'), 'utf8'), 'export const value = 2;\n');
    const replay = await invoke(fixture.provider, 'approval.decide', command);
    assert.equal(replay.replayed, true);
    assert.equal(fixture.db.prepare(`SELECT count(*) AS count FROM m2_lifecycle_approval_intents`).get().count, 1);
  } finally {
    fixture.close();
  }
}, 60_000);

await testAsync('reject is terminal in M2 and foreign subject sees an empty projection', async () => {
  const fixture = setup();
  try {
    await prepare(fixture, 'export const value = 3;\n');
    const page = await fixture.adapters.listApprovals(listRequest(), {
      deviceId: DEVICE_ID, subjectId: SUBJECT_ID,
    });
    const rejected = await fixture.adapters.decideApproval(
      decisionRequest(page.items[0], 'reject', 'operation:m7:approval:reject'),
      { deviceId: DEVICE_ID, subjectId: SUBJECT_ID },
    );
    assert.equal(rejected.outcome, 'CONFIRMED');
    assert.equal(rejected.approvalState, 'rejected');
    assert.equal(fixture.db.prepare(`SELECT count(*) AS count FROM m2_lifecycle_cancel_intents`).get().count, 1);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'src', 'app.js'), 'utf8'), 'export const value = 1;\n');

    const foreign = await fixture.adapters.listApprovals(listRequest({
      requestId: 'request:m7:approval:list:foreign',
    }), { deviceId: 'device:foreign', subjectId: 'operator-foreign' });
    assert.equal(foreign.status, 'ok');
    assert.deepEqual(foreign.items, []);
  } finally {
    fixture.close();
  }
}, 60_000);

summary();
