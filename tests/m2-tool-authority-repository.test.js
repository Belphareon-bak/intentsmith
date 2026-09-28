#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

import { suite, test, summary } from './harness.js';
import {
  M2_TOOL_CONTRACT_KIND,
  canonicalizeM2ToolValue,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
} from '../contracts/m2/tool-v1.js';
import {
  computeEffectRequestDigest,
  validateEffectResult,
  validateEffectResultForRequest,
} from '../contracts/m2/effect-v1.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
  M2_EFFECT_CORE_OBJECT_NAMES_V073,
  computeM2EffectCoreFingerprintV073,
} from '../src/db/m2-effect-core-v073-prerequisite.js';
import {
  EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT,
  computeToolV1SchemaFingerprint,
  up as applyToolAuthority,
} from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import {
  EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT,
  computeM2ToolEffectLinkSchemaFingerprint,
  up as applyToolEffectLinks,
} from '../src/db/migrations/2026_08_24_075_m2_tool_effect_links.js';
import {
  EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT,
  computeM2ToolTruthSchemaFingerprint,
  up as applyToolTruth,
} from '../src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js';
import { up as applyEffectInvalidations } from '../src/db/migrations/2026_08_24_077_m2_effect_invalidations.js';
import {
  M2ToolAuthorityErrorCode,
  M2ToolAuthorityRepository,
} from '../src/tools/m2-tool-authority-repository.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { processExecutionOwner } from '../src/effects/execution-owner.js';
import {
  getM2ToolDescriptor,
  expectedM2EffectOperationKey,
  projectM2EffectToolTerminal,
} from '../src/tools/m2-tool-registry.js';

function database() {
  const value = new Database(':memory:');
  value.pragma('foreign_keys = ON');
  applyEffectAuthority(value);
  applyEffectHardening(value);
  applyEffectClaims(value);
  applyEffectClaimTruth(value);
  applyToolAuthority(value);
  applyToolEffectLinks(value);
  applyToolTruth(value);
  applyEffectInvalidations(value);
  return value;
}

function databaseThrough075() {
  const value = new Database(':memory:');
  value.pragma('foreign_keys = ON');
  applyEffectAuthority(value);
  applyEffectHardening(value);
  applyEffectClaims(value);
  applyEffectClaimTruth(value);
  applyToolAuthority(value);
  applyToolEffectLinks(value);
  return value;
}

const fixedToolClock = () => Date.parse('2026-08-24T08:00:00.000Z');

function createFixedToolRepository(databaseValue) {
  return new M2ToolAuthorityRepository(databaseValue, { clock: fixedToolClock });
}

function request(overrides = {}) {
  const input = overrides.input || { query: '2+2' };
  return {
    contract: M2_TOOL_CONTRACT_KIND.REQUEST,
    version: 1,
    requestId: `tool:${'a'.repeat(64)}`,
    runId: `run:${'b'.repeat(64)}`,
    actor: { type: 'user', id: 'operator-1' },
    origin: {
      surface: 'studio',
      sessionId: `session:${'c'.repeat(64)}`,
      conversationId: `conversation:${'d'.repeat(64)}`,
      projectId: 7,
    },
    toolId: 'local.math',
    toolVersion: 1,
    riskClass: 'pure',
    authorityMode: 'direct',
    inputSchema: 'intentsmith.tool.local-math.input@1',
    outputSchema: 'intentsmith.tool.local-math.output@1',
    input,
    inputDigest: computeM2ToolValueDigest(input),
    requiredEffectKind: null,
    effectBinding: null,
    timeoutMs: 30_000,
    idempotencyKey: `tool-operation:${'e'.repeat(64)}`,
    createdAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

function result(toolRequest, overrides = {}) {
  const output = overrides.output || { subtype: 'math', expression: '2+2', result: 4 };
  return {
    contract: M2_TOOL_CONTRACT_KIND.RESULT,
    version: 1,
    requestId: toolRequest.requestId,
    requestDigest: computeM2ToolRequestDigest(toolRequest),
    runId: toolRequest.runId,
    projectId: toolRequest.origin.projectId,
    toolId: toolRequest.toolId,
    toolVersion: toolRequest.toolVersion,
    status: 'ok',
    outputSchema: 'intentsmith.tool.local-math.output@1',
    output,
    outputDigest: computeM2ToolValueDigest(output),
    effectRequestId: null,
    error: null,
    startedAt: '2026-08-24T08:00:00.001Z',
    completedAt: '2026-08-24T08:00:00.002Z',
    evidenceRefs: [],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function fileWriteAuthority({
  token = 'f',
  path = 'src/answer.js',
  content = 'export const answer = 42;\n',
} = {}) {
  const input = { path, content };
  const payload = Buffer.from(content, 'utf8');
  const payloadDigest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const toolRequest = request({
    requestId: `tool:${token.repeat(64)}`,
    input,
    inputDigest: computeM2ToolValueDigest(input),
    toolId: 'file.write',
    riskClass: 'write',
    authorityMode: 'effect',
    inputSchema: 'intentsmith.tool.file-write.input@1',
    outputSchema: 'intentsmith.tool.file-write.output@1',
    requiredEffectKind: 'fs.write',
    effectBinding: {
      kind: 'fs.write',
      target: { type: 'filesystem', relativePath: path },
      payloadDigest,
      payloadBytes: payload.length,
      requiredCapability: 'project.fs.write',
      riskClass: 'write',
    },
    idempotencyKey: `tool-operation:${token.repeat(64)}`,
  });
  const effectRequest = {
    contract: 'EffectRequest',
    version: 1,
    effectId: `effect:${token.repeat(64)}`,
    runId: toolRequest.runId,
    parentEffectId: null,
    actor: toolRequest.actor,
    origin: toolRequest.origin,
    kind: 'fs.write',
    target: {
      type: 'filesystem',
      canonicalRoot: '/workspace/project-a',
      relativePath: path,
      resolvedRealpath: `/workspace/project-a/${path}`,
    },
    payloadDigest,
    payloadBytes: payload.length,
    workspaceRevision: `wsr1:test-revision-${token}`,
    requiredCapability: 'project.fs.write',
    riskClass: 'write',
    timeoutMs: 30_000,
    idempotencyKey: expectedM2EffectOperationKey(toolRequest),
    approvalGrantId: null,
    createdAt: '2026-08-24T08:00:00.000Z',
  };
  return { toolRequest, effectRequest };
}

function failedFileWriteAuthority(token = '9') {
  const db = database();
  const clock = () => Date.parse('2026-08-24T08:00:00.001Z');
  const toolRepository = new M2ToolAuthorityRepository(db, { clock });
  const effectRepository = new EffectAuthorityRepository(db, { clock });
  const issuer = createApprovalGrantIssuer(effectRepository, {
    clock,
    grantIdFactory: () => `grant:${token.repeat(64)}`,
    nonceFactory: () => token.repeat(32),
  });
  const { toolRequest, effectRequest } = fileWriteAuthority({ token });
  toolRepository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(toolRepository, toolRequest.requestId);
  effectRepository.registerEffectRequest(effectRequest);
  toolRepository.bindToolEffect({
    requestId: toolRequest.requestId,
    effectRequestId: effectRequest.effectId,
    effectRequest,
  });
  const grant = issuer.issue({
    effectId: effectRequest.effectId,
    authenticatedSubject: { actorType: 'user', actorId: toolRequest.actor.id },
  }).grant;
  const boundEffectRequest = effectRepository.getEffectRequest(effectRequest.effectId);
  effectRepository.consumeApprovalGrant({
    grantId: grant.grantId,
    request: boundEffectRequest,
    executionOwner: processExecutionOwner,
  });
  const effectResult = {
    contract: 'EffectResult',
    version: 1,
    effectId: boundEffectRequest.effectId,
    runId: boundEffectRequest.runId,
    projectId: boundEffectRequest.origin.projectId,
    requestDigest: computeEffectRequestDigest(boundEffectRequest),
    approvalGrantId: grant.grantId,
    terminalStatus: 'failed',
    startedAt: '2026-08-24T08:00:00.001Z',
    completedAt: '2026-08-24T08:00:00.002Z',
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: null,
    errorCode: 'PROJECT_PATH_VIOLATION',
    evidenceRefs: [`effect:${boundEffectRequest.effectId}:fixture-failed`],
    lateCompletionRejected: false,
  };
  effectRepository.recordEffectResult(effectResult);
  const projection = projectM2EffectToolTerminal(
    toolRequest,
    getM2ToolDescriptor(toolRequest.toolId),
    boundEffectRequest,
    effectResult,
  );
  const toolResult = result(toolRequest, {
    status: projection.status,
    outputSchema: toolRequest.outputSchema,
    output: projection.output,
    outputDigest: projection.outputDigest,
    effectRequestId: projection.effectRequestId,
    error: projection.error,
    startedAt: projection.startedAt,
    completedAt: projection.completedAt,
    evidenceRefs: projection.evidenceRefs,
    lateCompletionRejected: projection.lateCompletionRejected,
  });
  return { db, toolRepository, toolRequest, toolResult, executionClaim };
}

function insertToolResultDirect(db, value) {
  const claim = db.prepare(`
    SELECT * FROM tool_v1_execution_claims
    WHERE request_id = ? ORDER BY generation DESC LIMIT 1
  `).get(value.requestId);
  db.prepare(`
    INSERT INTO tool_v1_results (
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, execution_generation, execution_owner_id,
      result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.requestId,
    value.requestDigest,
    value.runId,
    value.projectId,
    value.toolId,
    value.toolVersion,
    value.status,
    value.outputSchema,
    value.output === null ? null : JSON.stringify(value.output),
    value.outputDigest,
    value.effectRequestId,
    value.error === null ? null : JSON.stringify(value.error),
    Date.parse(value.startedAt),
    Date.parse(value.completedAt),
    JSON.stringify(value.evidenceRefs),
    value.lateCompletionRejected ? 1 : 0,
    claim.generation,
    claim.owner_id,
    JSON.stringify(value),
  );
}

function insertPre076ToolResult(db, value) {
  db.prepare(`
    INSERT INTO tool_v1_results (
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.requestId,
    value.requestDigest,
    value.runId,
    value.projectId,
    value.toolId,
    value.toolVersion,
    value.status,
    value.outputSchema,
    value.output === null ? null : canonicalizeM2ToolValue(value.output),
    value.outputDigest,
    value.effectRequestId,
    value.error === null ? null : canonicalizeM2ToolValue(value.error),
    Date.parse(value.startedAt),
    Date.parse(value.completedAt),
    canonicalizeM2ToolValue(value.evidenceRefs),
    value.lateCompletionRejected ? 1 : 0,
    canonicalizeM2ToolValue(value),
  );
}

function claimFor(repository, requestId) {
  return repository.claimToolExecution({
    requestId,
    executionOwner: processExecutionOwner,
  }).claim;
}

suite('M2 durable tool authority — request and exact replay');

test('forward migration installs nullable-project requests, claims and exact terminal truth', () => {
  const db = database();
  const names = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE name LIKE 'tool_v1_%' OR name LIKE 'trg_tool_v1_%'
    ORDER BY name
  `).all().map(row => row.name);
  assert.equal(names.includes('tool_v1_requests'), true);
  assert.equal(names.includes('tool_v1_results'), true);
  assert.equal(names.includes('tool_v1_execution_claims'), true);
  assert.equal(names.includes('trg_tool_v1_results_exact_effect'), true);
  assert.equal(
    computeM2ToolTruthSchemaFingerprint(db),
    EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT,
  );
  applyToolTruth(db);
  assert.equal(
    computeM2ToolTruthSchemaFingerprint(db),
    EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT,
  );
  db.close();
});

test('076 upgrades populated 074/075 authority without loss and is idempotent', () => {
  const db = databaseThrough075();
  const oldToolRepository = new M2ToolAuthorityRepository(db, {
    clock: () => Date.parse('2026-08-24T08:00:00.001Z'),
  });
  const effectRepository = new EffectAuthorityRepository(db, {
    clock: () => Date.parse('2026-08-24T08:00:00.001Z'),
  });
  const directRequest = request();
  const directResult = result(directRequest);
  const linked = fileWriteAuthority({
    token: 'b',
    path: 'src/preserved.js',
    content: 'preserved\n',
  });
  oldToolRepository.registerToolRequest(directRequest);
  insertPre076ToolResult(db, directResult);
  oldToolRepository.registerToolRequest(linked.toolRequest);
  effectRepository.registerEffectRequest(linked.effectRequest);
  oldToolRepository.bindToolEffect({
    requestId: linked.toolRequest.requestId,
    effectRequestId: linked.effectRequest.effectId,
    effectRequest: linked.effectRequest,
  });

  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results,
      (SELECT count(*) FROM m2_tool_effect_links) AS links
  `).get(), { requests: 2, results: 1, links: 1 });

  applyToolTruth(db);
  const upgraded = createFixedToolRepository(db);
  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results,
      (SELECT count(*) FROM m2_tool_effect_links) AS links,
      (SELECT count(*) FROM tool_v1_execution_claims) AS claims
  `).get(), { requests: 2, results: 1, links: 1, claims: 2 });
  assert.deepEqual(upgraded.getToolRequest(directRequest.requestId), directRequest);
  assert.deepEqual(upgraded.getToolResult(directRequest.requestId), directResult);
  assert.equal(
    upgraded.getEffectLinkByRequest(linked.toolRequest.requestId).effectId,
    linked.effectRequest.effectId,
  );
  assert.equal(upgraded.getToolExecutionClaim(directRequest.requestId).ownerId, 'migration:pre-076');
  assert.equal(upgraded.getToolExecutionClaim(linked.toolRequest.requestId).ownerId, 'migration:pre-076');

  applyToolTruth(db);
  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results,
      (SELECT count(*) FROM m2_tool_effect_links) AS links,
      (SELECT count(*) FROM tool_v1_execution_claims) AS claims
  `).get(), { requests: 2, results: 1, links: 1, claims: 2 });
  db.close();
});

test('076 permits a no-project effectful denial while preserving exact terminal fencing', () => {
  const db = databaseThrough075();
  applyToolTruth(db);
  const repository = createFixedToolRepository(db);
  const input = { query: 'IntentSmith' };
  const descriptor = getM2ToolDescriptor('web.search');
  const toolRequest = request({
    requestId: `tool:${'7'.repeat(64)}`,
    origin: {
      surface: 'studio',
      sessionId: `session:${'c'.repeat(64)}`,
      conversationId: `conversation:${'d'.repeat(64)}`,
      projectId: null,
    },
    toolId: 'web.search',
    riskClass: 'network',
    authorityMode: 'effect',
    inputSchema: 'intentsmith.tool.web-search.input@1',
    outputSchema: 'intentsmith.tool.web-search.output@1',
    input,
    inputDigest: computeM2ToolValueDigest(input),
    requiredEffectKind: 'network.request',
    effectBinding: descriptor.buildEffectBinding(input),
    idempotencyKey: `tool-operation:${'7'.repeat(64)}`,
  });
  repository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(repository, toolRequest.requestId);
  const toolResult = result(toolRequest, {
    status: 'error',
    outputSchema: toolRequest.outputSchema,
    output: null,
    outputDigest: null,
    error: {
      code: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      message: 'network authority unavailable',
      retryable: false,
    },
  });
  repository.recordToolResult(toolResult, { executionClaim });
  assert.deepEqual(repository.getToolResult(toolRequest.requestId), toolResult);
  assert.equal(repository.getToolRequest(toolRequest.requestId).origin.projectId, null);
  db.close();
});

test('076 rejects drifted 074/075 source before rebuilding any authority table', () => {
  const db = databaseThrough075();
  db.exec('ALTER TABLE tool_v1_requests ADD COLUMN drift_marker TEXT');
  assert.throws(
    () => applyToolTruth(db),
    /M2_TOOL_TRUTH_076_SOURCE_SCHEMA_FINGERPRINT_MISMATCH/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'tool_v1_execution_claims'").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM pragma_table_info('tool_v1_requests') WHERE name = 'drift_marker'").get().count,
    1,
  );
  db.close();
});

test('committed 073 migration remains byte-identical while prerequisite logic evolves forward', () => {
  const bytes = readFileSync(new URL(
    '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js',
    import.meta.url,
  ));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'd3daedb9ab51fdc5a6adfee3409c303433b43e610585353161824f1271363aff',
  );
});

test('076 and 077 reject removal of every 073 effect-core trigger or index before mutation', () => {
  const securityObjects = M2_EFFECT_CORE_OBJECT_NAMES_V073.filter(name => (
    name.startsWith('trg_') || name.startsWith('idx_')
  ));
  assert.ok(securityObjects.length > 0);
  for (const migration of [applyToolTruth, applyEffectInvalidations]) {
    for (const objectName of securityObjects) {
      const db = databaseThrough075();
      assert.equal(
        computeM2EffectCoreFingerprintV073(db),
        EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
      );
      db.exec(`DROP ${objectName.startsWith('trg_') ? 'TRIGGER' : 'INDEX'} "${objectName}"`);
      assert.throws(
        () => migration(db),
        /EFFECT_CORE_SCHEMA_FINGERPRINT_MISMATCH/,
        `${migration.name} must reject missing ${objectName}`,
      );
      assert.equal(
        db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'tool_v1_execution_claims'").get().count,
        0,
      );
      assert.equal(
        db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'm2_effect_invalidations'").get().count,
        0,
      );
      db.close();
    }
  }
});

test('migration refuses a pre-existing or drifted tool authority schema', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE tool_v1_requests (request_id TEXT PRIMARY KEY)');
  assert.throws(
    () => applyToolAuthority(db),
    /074_SOURCE_SCHEMA_FINGERPRINT_MISMATCH/,
  );
  assert.deepEqual(
    db.prepare('PRAGMA table_info(tool_v1_requests)').all().map(row => row.name),
    ['request_id'],
  );
  db.close();
});

test('exact duplicate request is idempotent and drift conflicts', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const value = request();
  assert.equal(repository.registerToolRequest(value).created, true);
  assert.equal(repository.registerToolRequest(value).created, false);
  assert.deepEqual(repository.getToolRequest(value.requestId), value);
  assert.throws(
    () => repository.registerToolRequest({
      ...value,
      input: { query: '3+3' },
      inputDigest: computeM2ToolValueDigest({ query: '3+3' }),
    }),
    error => error.code === M2ToolAuthorityErrorCode.REQUEST_CONFLICT,
  );
  assert.deepEqual(repository.getToolRequest(value.requestId), value);
  db.close();
});

test('same run/idempotency key cannot be rebound to another request ID', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const value = request();
  repository.registerToolRequest(value);
  assert.throws(
    () => repository.registerToolRequest({ ...value, requestId: `tool:${'f'.repeat(64)}` }),
    error => error.code === M2ToolAuthorityErrorCode.REQUEST_CONFLICT,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM tool_v1_requests').get().count, 1);
  db.close();
});

test('tool execution claims cannot predate their durable ToolRequest', () => {
  const requestCreatedAtMs = Date.parse('2026-08-24T08:00:00.000Z');
  const db = database();
  const repository = new M2ToolAuthorityRepository(db, {
    clock: () => requestCreatedAtMs - 1,
  });
  const toolRequest = request({ createdAt: '2026-08-24T08:00:00.000Z' });
  repository.registerToolRequest(toolRequest);
  assert.throws(
    () => repository.claimToolExecution({
      requestId: toolRequest.requestId,
      executionOwner: processExecutionOwner,
    }),
    error => error.code === M2ToolAuthorityErrorCode.INPUT_INVALID,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM tool_v1_execution_claims').get().count, 0);
  assert.throws(() => db.prepare(`
    INSERT INTO tool_v1_execution_claims (
      request_id, request_digest, generation, owner_id, owner_pid,
      owner_boot_id, owner_start_identity, claimed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toolRequest.requestId,
    computeM2ToolRequestDigest(toolRequest),
    1,
    processExecutionOwner.ownerId,
    processExecutionOwner.pid,
    processExecutionOwner.bootId,
    processExecutionOwner.startIdentity,
    requestCreatedAtMs - 1,
  ), /M2_TOOL_EXECUTION_CLAIM_AUTHORITY_MISMATCH/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM tool_v1_execution_claims').get().count, 0);
  db.close();
});

suite('M2 durable tool authority — immutable terminal truth');

test('one exact terminal is durable and duplicate commit is idempotent', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const toolRequest = request();
  const toolResult = result(toolRequest);
  repository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(repository, toolRequest.requestId);
  assert.equal(repository.recordToolResult(toolResult, { executionClaim }).created, true);
  assert.equal(repository.recordToolResult(toolResult, { executionClaim }).created, false);
  assert.deepEqual(repository.getToolResult(toolRequest.requestId), toolResult);
  assert.throws(
    () => repository.claimToolExecution({
      requestId: toolRequest.requestId,
      executionOwner: processExecutionOwner,
    }),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_CONFLICT,
  );
  db.close();
});

test('conflicting terminal and mismatched request digest are rejected', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const toolRequest = request();
  const toolResult = result(toolRequest);
  repository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(repository, toolRequest.requestId);
  repository.recordToolResult(toolResult, { executionClaim });
  assert.throws(
    () => repository.recordToolResult(result(toolRequest, {
      output: { subtype: 'math', expression: '2+2', result: 5 },
      outputDigest: computeM2ToolValueDigest({ subtype: 'math', expression: '2+2', result: 5 }),
    }), { executionClaim }),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_CONFLICT,
  );
  const mismatchDb = database();
  const mismatchRepository = createFixedToolRepository(mismatchDb);
  mismatchRepository.registerToolRequest(toolRequest);
  const mismatchClaim = claimFor(mismatchRepository, toolRequest.requestId);
  const wrongDigest = { ...toolResult, requestDigest: `sha256:${'0'.repeat(64)}` };
  assert.throws(
    () => mismatchRepository.recordToolResult(wrongDigest, { executionClaim: mismatchClaim }),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
  );
  mismatchDb.close();
  db.close();
});

test('append-only triggers reject direct mutation and deletion', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const toolRequest = request();
  repository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(repository, toolRequest.requestId);
  repository.recordToolResult(result(toolRequest), { executionClaim });
  assert.throws(
    () => db.prepare('UPDATE tool_v1_requests SET tool_id = ? WHERE request_id = ?')
      .run('forged', toolRequest.requestId),
    /append-only/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM tool_v1_results WHERE request_id = ?').run(toolRequest.requestId),
    /append-only/,
  );
  db.close();
});

test('direct SQL cannot mismatch indexed identity and request JSON', () => {
  const db = database();
  const value = request();
  const encoded = JSON.stringify(value);
  assert.throws(() => db.prepare(`
    INSERT INTO tool_v1_requests (
      request_id, request_digest, run_id, project_id, actor_type, actor_id,
      surface, session_id, conversation_id, tool_id, tool_version, risk_class,
      input_schema, input_digest, required_effect_kind, timeout_ms,
      idempotency_key, request_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.requestId,
    computeM2ToolRequestDigest(value),
    value.runId,
    value.origin.projectId,
    value.actor.type,
    value.actor.id,
    value.origin.surface,
    value.origin.sessionId,
    value.origin.conversationId,
    'web.search',
    value.toolVersion,
    value.riskClass,
    value.inputSchema,
    value.inputDigest,
    value.requiredEffectKind,
    value.timeoutMs,
    value.idempotencyKey,
    encoded,
    Date.parse(value.createdAt),
  ));
  assert.equal(db.prepare('SELECT count(*) AS count FROM tool_v1_requests').get().count, 0);
  db.close();
});

test('validly digested direct-SQL request cannot forge the installed registry descriptor', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const forged = request({
    riskClass: 'exec',
    authorityMode: 'unavailable',
    requiredEffectKind: 'process.exec',
  });
  db.prepare(`
    INSERT INTO tool_v1_requests (
      request_id, request_digest, run_id, project_id, actor_type, actor_id,
      surface, session_id, conversation_id, tool_id, tool_version, risk_class,
      input_schema, input_digest, required_effect_kind, timeout_ms,
      idempotency_key, request_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    forged.requestId,
    computeM2ToolRequestDigest(forged),
    forged.runId,
    forged.origin.projectId,
    forged.actor.type,
    forged.actor.id,
    forged.origin.surface,
    forged.origin.sessionId,
    forged.origin.conversationId,
    forged.toolId,
    forged.toolVersion,
    forged.riskClass,
    forged.inputSchema,
    forged.inputDigest,
    forged.requiredEffectKind,
    forged.timeoutMs,
    forged.idempotencyKey,
    JSON.stringify(forged),
    Date.parse(forged.createdAt),
  );
  assert.throws(
    () => repository.getToolRequest(forged.requestId),
    error => error.code === M2ToolAuthorityErrorCode.STORAGE_FAILURE,
  );
  db.close();
});

test('direct-SQL result projection drift is unreadable even when result JSON is valid', () => {
  const db = database();
  const repository = createFixedToolRepository(db);
  const toolRequest = request();
  const toolResult = result(toolRequest);
  repository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(repository, toolRequest.requestId);
  db.prepare(`
    INSERT INTO tool_v1_results (
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, execution_generation, execution_owner_id,
      result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toolResult.requestId,
    toolResult.requestDigest,
    toolResult.runId,
    toolResult.projectId,
    toolResult.toolId,
    toolResult.toolVersion,
    toolResult.status,
    toolResult.outputSchema,
    JSON.stringify({ subtype: 'math', expression: '2+2', result: 99 }),
    toolResult.outputDigest,
    toolResult.effectRequestId,
    null,
    Date.parse(toolResult.startedAt),
    Date.parse(toolResult.completedAt),
    JSON.stringify(toolResult.evidenceRefs),
    0,
    executionClaim.generation,
    executionClaim.ownerId,
    JSON.stringify(toolResult),
  );
  assert.throws(
    () => repository.getToolResult(toolRequest.requestId),
    error => error.code === M2ToolAuthorityErrorCode.STORAGE_FAILURE,
  );
  db.close();
});

test('tool/effect link is exact, idempotent and append-only', () => {
  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db, { clock: () => 1_777_000_000_000 });
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => 1_777_000_000_000 });
  const { toolRequest, effectRequest } = fileWriteAuthority();
  toolRepository.registerToolRequest(toolRequest);
  effectRepository.registerEffectRequest(effectRequest);
  assert.equal(toolRepository.bindToolEffect({
    requestId: toolRequest.requestId,
    effectRequestId: effectRequest.effectId,
    effectRequest,
  }).created, true);
  assert.equal(toolRepository.bindToolEffect({
    requestId: toolRequest.requestId,
    effectRequestId: effectRequest.effectId,
    effectRequest,
  }).created, false);
  const link = toolRepository.getEffectLinkByRequest(toolRequest.requestId);
  assert.equal(link.effectId, effectRequest.effectId);
  assert.equal(link.effectRequestDigest, computeEffectRequestDigest(effectRequest));
  assert.throws(
    () => toolRepository.claimToolExecution({
      requestId: toolRequest.requestId,
      executionOwner: processExecutionOwner,
    }),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_CONFLICT,
  );
  assert.throws(() => db.prepare(`
    INSERT INTO tool_v1_execution_claims (
      request_id, request_digest, generation, owner_id, owner_pid,
      owner_boot_id, owner_start_identity, claimed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toolRequest.requestId,
    computeM2ToolRequestDigest(toolRequest),
    1,
    processExecutionOwner.ownerId,
    processExecutionOwner.pid,
    processExecutionOwner.bootId,
    processExecutionOwner.startIdentity,
    Date.parse(toolRequest.createdAt),
  ), /M2_TOOL_EXECUTION_CLAIM_AFTER_TERMINAL_OR_LINK/);
  assert.throws(
    () => db.prepare('UPDATE m2_tool_effect_links SET linked_at_ms = linked_at_ms + 1').run(),
    /append-only/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM m2_tool_effect_links').run(),
    /append-only/,
  );
  db.close();
});

test('same-input operations cannot swap EffectRequests across ToolRequest identities', () => {
  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db, { clock: () => 1_777_000_000_000 });
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => 1_777_000_000_000 });
  const authorityA = fileWriteAuthority({ token: 'a', path: 'src/same.js', content: 'same\n' });
  const authorityB = fileWriteAuthority({ token: 'b', path: 'src/same.js', content: 'same\n' });
  for (const authority of [authorityA, authorityB]) {
    toolRepository.registerToolRequest(authority.toolRequest);
    effectRepository.registerEffectRequest(authority.effectRequest);
  }
  assert.notEqual(
    expectedM2EffectOperationKey(authorityA.toolRequest),
    expectedM2EffectOperationKey(authorityB.toolRequest),
  );
  assert.throws(
    () => toolRepository.bindToolEffect({
      requestId: authorityA.toolRequest.requestId,
      effectRequestId: authorityB.effectRequest.effectId,
      effectRequest: authorityB.effectRequest,
    }),
    error => error.code === M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
  );
  assert.throws(
    () => toolRepository.invalidatePendingEffect({
      requestId: authorityA.toolRequest.requestId,
      effectRequestId: authorityB.effectRequest.effectId,
    }),
    error => error.code === M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
  );
  const forgedTranslationDigest = computeM2ToolValueDigest({
    toolRequestDigest: computeM2ToolRequestDigest(authorityA.toolRequest),
    effectRequestDigest: computeEffectRequestDigest(authorityB.effectRequest),
    effectBinding: authorityA.toolRequest.effectBinding,
  });
  const forgedLink = {
    requestId: authorityA.toolRequest.requestId,
    effectId: authorityB.effectRequest.effectId,
    toolRequestDigest: computeM2ToolRequestDigest(authorityA.toolRequest),
    effectRequestDigest: computeEffectRequestDigest(authorityB.effectRequest),
    translationDigest: forgedTranslationDigest,
    linkedAtMs: 1_777_000_000_000,
  };
  assert.throws(() => db.prepare(`
    INSERT INTO m2_tool_effect_links (
      request_id, effect_id, tool_request_digest, effect_request_digest,
      translation_digest, link_json, linked_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    forgedLink.requestId,
    forgedLink.effectId,
    forgedLink.toolRequestDigest,
    forgedLink.effectRequestDigest,
    forgedLink.translationDigest,
    JSON.stringify(forgedLink),
    forgedLink.linkedAtMs,
  ), /M2_TOOL_EFFECT_OPERATION_KEY_MISMATCH/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_tool_effect_links').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_effect_invalidations').get().count, 0);
  db.close();
});

test('effectful ToolResult success is rejected until canonical EffectResult is durable', () => {
  const db = database();
  const toolRepository = createFixedToolRepository(db);
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => 1_777_000_000_000 });
  const toolInput = { path: 'src/answer.js', content: 'export const answer = 42;\n' };
  const toolRequest = request({
    input: toolInput,
    inputDigest: computeM2ToolValueDigest(toolInput),
    toolId: 'file.write',
    riskClass: 'write',
    inputSchema: 'intentsmith.tool.file-write.input@1',
    requiredEffectKind: 'fs.write',
  });
  const payload = Buffer.from(toolInput.content, 'utf8');
  const payloadDigest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const effectRequest = {
    contract: 'EffectRequest',
    version: 1,
    effectId: `effect:${'f'.repeat(64)}`,
    runId: toolRequest.runId,
    parentEffectId: null,
    actor: toolRequest.actor,
    origin: toolRequest.origin,
    kind: 'fs.write',
    target: {
      type: 'filesystem',
      canonicalRoot: '/workspace/project-a',
      relativePath: toolInput.path,
      resolvedRealpath: '/workspace/project-a/src/answer.js',
    },
    payloadDigest,
    payloadBytes: payload.length,
    workspaceRevision: 'wsr1:test-revision',
    requiredCapability: 'project.fs.write',
    riskClass: 'write',
    timeoutMs: 30_000,
    idempotencyKey: expectedM2EffectOperationKey(toolRequest),
    approvalGrantId: null,
    createdAt: '2026-08-24T08:00:00.000Z',
  };
  const exactToolRequest = {
    ...toolRequest,
    authorityMode: 'effect',
    outputSchema: 'intentsmith.tool.file-write.output@1',
    effectBinding: {
      kind: 'fs.write',
      target: { type: 'filesystem', relativePath: toolInput.path },
      payloadDigest,
      payloadBytes: payload.length,
      requiredCapability: 'project.fs.write',
      riskClass: 'write',
    },
  };
  toolRepository.registerToolRequest(exactToolRequest);
  const executionClaim = claimFor(toolRepository, exactToolRequest.requestId);
  effectRepository.registerEffectRequest(effectRequest);
  const output = {
    path: toolInput.path,
    effectId: effectRequest.effectId,
    terminalStatus: 'succeeded',
  };
  const toolResult = result(exactToolRequest, {
    output,
    outputSchema: 'intentsmith.tool.file-write.output@1',
    outputDigest: computeM2ToolValueDigest(output),
    effectRequestId: effectRequest.effectId,
  });
  toolRepository.bindToolEffect({
    requestId: exactToolRequest.requestId,
    effectRequestId: effectRequest.effectId,
    effectRequest,
  });
  assert.throws(
    () => toolRepository.recordToolResult(toolResult, {
      executionClaim,
    }),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
  );
  assert.equal(toolRepository.getToolResult(exactToolRequest.requestId), null);
  db.close();
});

test('semantic fs.write evidence is enforced by SQL and by both repository read paths', () => {
  const db = database();
  const clock = () => Date.parse('2026-08-24T08:00:00.001Z');
  const toolRepository = new M2ToolAuthorityRepository(db, { clock });
  const effectRepository = new EffectAuthorityRepository(db, { clock });
  const issuer = createApprovalGrantIssuer(effectRepository, {
    clock,
    grantIdFactory: () => `grant:${'6'.repeat(64)}`,
    nonceFactory: () => '6'.repeat(32),
  });
  const authority = fileWriteAuthority({
    token: '6',
    path: 'src/semantic.js',
    content: 'semantic\n',
  });
  toolRepository.registerToolRequest(authority.toolRequest);
  effectRepository.registerEffectRequest(authority.effectRequest);
  toolRepository.bindToolEffect({
    requestId: authority.toolRequest.requestId,
    effectRequestId: authority.effectRequest.effectId,
    effectRequest: authority.effectRequest,
  });
  const grant = issuer.issue({
    effectId: authority.effectRequest.effectId,
    authenticatedSubject: { actorType: 'user', actorId: authority.toolRequest.actor.id },
  }).grant;
  const boundRequest = effectRepository.getEffectRequest(authority.effectRequest.effectId);
  effectRepository.consumeApprovalGrant({
    grantId: grant.grantId,
    request: boundRequest,
    executionOwner: processExecutionOwner,
  });
  const forged = {
    contract: 'EffectResult',
    version: 1,
    effectId: boundRequest.effectId,
    runId: boundRequest.runId,
    projectId: boundRequest.origin.projectId,
    requestDigest: computeEffectRequestDigest(boundRequest),
    approvalGrantId: grant.grantId,
    terminalStatus: 'succeeded',
    startedAt: '2026-08-24T08:00:00.001Z',
    completedAt: '2026-08-24T08:00:00.002Z',
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: boundRequest.payloadDigest,
    errorCode: null,
    evidenceRefs: [],
    lateCompletionRejected: false,
  };
  assert.equal(validateEffectResult(forged).valid, true);
  assert.equal(validateEffectResultForRequest(boundRequest, forged).valid, false);
  assert.throws(
    () => effectRepository.recordEffectResult(forged),
    error => error.code === 'EFFECT_RESULT_AUTHORITY_MISSING',
  );
  const insertForged = () => db.prepare(`
    INSERT INTO m2_effect_results (
      effect_id, run_id, project_id, request_digest, approval_grant_id,
      terminal_status, result_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    forged.effectId,
    forged.runId,
    forged.projectId,
    forged.requestDigest,
    forged.approvalGrantId,
    forged.terminalStatus,
    JSON.stringify(forged),
    Date.parse(forged.completedAt),
  );
  assert.throws(insertForged, /M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH/);
  assert.equal(effectRepository.getEffectResult(forged.effectId), null);
  assert.equal(toolRepository.getExactEffectResult(forged.effectId), null);

  // Simulate an externally damaged database with the SQL semantic trigger
  // removed. Both read paths must still refuse the otherwise generic-valid row.
  db.exec('DROP TRIGGER trg_m2_effect_results_semantic_authority');
  insertForged();
  assert.throws(
    () => effectRepository.getEffectResult(forged.effectId),
    error => error.code === 'EFFECT_AUTHORITY_STORAGE_FAILURE',
  );
  assert.throws(
    () => toolRepository.getExactEffectResult(forged.effectId),
    error => error.code === M2ToolAuthorityErrorCode.STORAGE_FAILURE,
  );
  db.close();
});

test('bare SQL operation tombstone atomically neutralizes pending authority and rejects terminal effects', () => {
  const invalidatedAtMs = Date.parse('2026-08-24T08:00:00.001Z');
  const insertOperationTombstone = (db, toolRequest, reasonCode) => db.prepare(`
    INSERT INTO m2_tool_effect_operation_invalidations (
      source_tool_request_id, tool_request_digest, run_id, project_id,
      effect_idempotency_key, reason_code, invalidated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    toolRequest.requestId,
    computeM2ToolRequestDigest(toolRequest),
    toolRequest.runId,
    toolRequest.origin.projectId,
    expectedM2EffectOperationKey(toolRequest),
    reasonCode,
    invalidatedAtMs,
  );

  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const effectRepository = new EffectAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const { toolRequest, effectRequest } = fileWriteAuthority({
    token: '7',
    path: 'src/direct-tombstone.js',
    content: 'direct tombstone\n',
  });
  const payload = Buffer.from(toolRequest.input.content, 'utf8');
  toolRepository.registerToolRequest(toolRequest);
  effectRepository.registerEffectRequest(effectRequest);
  db.prepare(`
    INSERT INTO m2_pending_effect_payloads (
      effect_id, session_id, conversation_id, subject_id, project_id,
      payload, payload_digest, payload_bytes, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    effectRequest.effectId,
    effectRequest.origin.sessionId,
    effectRequest.origin.conversationId,
    effectRequest.actor.id,
    effectRequest.origin.projectId,
    payload,
    effectRequest.payloadDigest,
    effectRequest.payloadBytes,
    invalidatedAtMs,
  );

  insertOperationTombstone(db, toolRequest, 'TOOL_EFFECT_PREPARATION_TIMEOUT');
  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operations,
      (SELECT count(*) FROM m2_effect_invalidations) AS effects,
      (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
      (SELECT count(*) FROM m2_approval_grants) AS grants,
      (SELECT count(*) FROM m2_effect_results) AS results,
      (SELECT count(*) FROM m2_tool_effect_links) AS links
  `).get(), { operations: 1, effects: 1, pending: 0, grants: 0, results: 0, links: 0 });
  assert.deepEqual(toolRepository.getToolEffectOperationInvalidation(toolRequest.requestId), {
    requestId: toolRequest.requestId,
    effectId: effectRequest.effectId,
    operationKey: expectedM2EffectOperationKey(toolRequest),
    reasonCode: 'TOOL_EFFECT_PREPARATION_TIMEOUT',
    invalidatedAtMs,
  });
  assert.throws(
    () => toolRepository.bindToolEffect({
      requestId: toolRequest.requestId,
      effectRequestId: effectRequest.effectId,
      effectRequest,
    }),
    error => error.code === M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
  );
  const issuer = createApprovalGrantIssuer(effectRepository, {
    clock: () => invalidatedAtMs,
    grantIdFactory: () => `grant:${'7'.repeat(64)}`,
    nonceFactory: () => '7'.repeat(32),
  });
  assert.throws(
    () => issuer.issue({
      effectId: effectRequest.effectId,
      authenticatedSubject: { actorType: 'user', actorId: toolRequest.actor.id },
    }),
    error => error.code === 'EFFECT_AUTHORITY_STORAGE_FAILURE',
  );
  db.close();

  const terminalDb = database();
  const terminalToolRepository = new M2ToolAuthorityRepository(terminalDb, {
    clock: () => invalidatedAtMs,
  });
  const terminalEffectRepository = new EffectAuthorityRepository(terminalDb, {
    clock: () => invalidatedAtMs,
  });
  const terminalAuthority = fileWriteAuthority({ token: '5' });
  terminalToolRepository.registerToolRequest(terminalAuthority.toolRequest);
  terminalEffectRepository.registerEffectRequest(terminalAuthority.effectRequest);
  createApprovalGrantIssuer(terminalEffectRepository, {
    clock: () => invalidatedAtMs,
    grantIdFactory: () => `grant:${'5'.repeat(64)}`,
    nonceFactory: () => '5'.repeat(32),
  }).issue({
    effectId: terminalAuthority.effectRequest.effectId,
    authenticatedSubject: {
      actorType: 'user',
      actorId: terminalAuthority.toolRequest.actor.id,
    },
  });
  assert.throws(
    () => insertOperationTombstone(
      terminalDb,
      terminalAuthority.toolRequest,
      'TOOL_EFFECT_PREPARATION_FAILED',
    ),
    /M2_TOOL_EFFECT_OPERATION_INVALIDATION_AUTHORITY_MISMATCH/,
  );
  assert.deepEqual(terminalDb.prepare(`
    SELECT
      (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operations,
      (SELECT count(*) FROM m2_effect_invalidations) AS effects,
      (SELECT count(*) FROM m2_approval_grants) AS grants
  `).get(), { operations: 0, effects: 0, grants: 1 });
  terminalDb.close();
});

test('standalone invalidation closes a poisoned effect under the exact operation tuple', () => {
  const invalidatedAtMs = Date.parse('2026-08-24T08:00:00.001Z');
  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const effectRepository = new EffectAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const { toolRequest, effectRequest } = fileWriteAuthority({
    token: '6',
    path: 'src/owned.js',
    content: 'owned bytes\n',
  });
  const poisonedEffect = {
    ...effectRequest,
    target: {
      ...effectRequest.target,
      relativePath: 'src/poisoned.js',
      resolvedRealpath: '/workspace/project-a/src/poisoned.js',
    },
  };
  const payload = Buffer.from(toolRequest.input.content, 'utf8');
  toolRepository.registerToolRequest(toolRequest);
  effectRepository.registerEffectRequest(poisonedEffect);
  db.prepare(`
    INSERT INTO m2_pending_effect_payloads (
      effect_id, session_id, conversation_id, subject_id, project_id,
      payload, payload_digest, payload_bytes, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    poisonedEffect.effectId,
    poisonedEffect.origin.sessionId,
    poisonedEffect.origin.conversationId,
    poisonedEffect.actor.id,
    poisonedEffect.origin.projectId,
    payload,
    poisonedEffect.payloadDigest,
    poisonedEffect.payloadBytes,
    invalidatedAtMs,
  );
  db.prepare(`
    INSERT INTO m2_effect_invalidations (
      effect_id, request_digest, source_tool_request_id,
      reason_code, invalidated_at_ms
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    poisonedEffect.effectId,
    computeEffectRequestDigest(poisonedEffect),
    toolRequest.requestId,
    'TOOL_EFFECT_TRANSLATION_INVALID',
    invalidatedAtMs,
  );

  const expected = {
    requestId: toolRequest.requestId,
    effectId: poisonedEffect.effectId,
    operationKey: expectedM2EffectOperationKey(toolRequest),
    reasonCode: 'TOOL_EFFECT_TRANSLATION_INVALID',
    invalidatedAtMs,
  };
  assert.deepEqual(toolRepository.getToolEffectInvalidation(toolRequest.requestId), expected);
  assert.deepEqual(toolRepository.invalidateToolEffectOperation({
    requestId: toolRequest.requestId,
    reasonCode: 'TOOL_EFFECT_TRANSLATION_INVALID',
  }), expected);
  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
      (SELECT count(*) FROM m2_effect_invalidations) AS invalidations,
      (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operations,
      (SELECT count(*) FROM m2_tool_effect_links) AS links,
      (SELECT count(*) FROM m2_approval_grants) AS grants,
      (SELECT count(*) FROM m2_effect_results) AS results
  `).get(), {
    pending: 0,
    invalidations: 1,
    operations: 0,
    links: 0,
    grants: 0,
    results: 0,
  });
  assert.throws(
    () => toolRepository.bindToolEffect({
      requestId: toolRequest.requestId,
      effectRequestId: poisonedEffect.effectId,
      effectRequest: poisonedEffect,
    }),
    error => error.code === M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
  );
  db.close();
});

test('an unlinked effectful terminal cannot leave a prepared effect approvable', () => {
  const invalidatedAtMs = Date.parse('2026-08-24T08:00:00.001Z');
  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const effectRepository = new EffectAuthorityRepository(db, {
    clock: () => invalidatedAtMs,
  });
  const { toolRequest, effectRequest } = fileWriteAuthority({
    token: '4',
    path: 'src/must-not-run.js',
    content: 'must not run\n',
  });
  const terminal = result(toolRequest, {
    status: 'error',
    outputSchema: toolRequest.outputSchema,
    output: null,
    outputDigest: null,
    effectRequestId: null,
    error: {
      code: 'TOOL_EFFECT_EXECUTION_FAILED',
      message: 'effect preparation failed',
      retryable: false,
    },
  });
  toolRepository.registerToolRequest(toolRequest);
  const executionClaim = claimFor(toolRepository, toolRequest.requestId);
  effectRepository.registerEffectRequest(effectRequest);

  assert.throws(
    () => toolRepository.recordToolResult(terminal, { executionClaim }),
    error => error.code === M2ToolAuthorityErrorCode.STORAGE_FAILURE
      && error.details?.cause === 'M2_TOOL_EFFECT_TERMINAL_WITH_LIVE_AUTHORITY',
  );
  assert.throws(
    () => insertToolResultDirect(db, terminal),
    /M2_TOOL_EFFECT_TERMINAL_WITH_LIVE_AUTHORITY/,
  );
  assert.equal(toolRepository.getToolResult(toolRequest.requestId), null);

  const invalidation = toolRepository.invalidateToolEffectOperation({
    requestId: toolRequest.requestId,
    reasonCode: 'TOOL_EFFECT_PREPARATION_FAILED',
  });
  assert.equal(invalidation.effectId, effectRequest.effectId);
  assert.equal(toolRepository.recordToolResult(terminal, { executionClaim }).created, true);
  assert.deepEqual(toolRepository.getToolResult(toolRequest.requestId), terminal);
  assert.deepEqual(db.prepare(`
    SELECT
      (SELECT count(*) FROM m2_effect_invalidations) AS invalidations,
      (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
      (SELECT count(*) FROM m2_approval_grants) AS grants,
      (SELECT count(*) FROM m2_effect_results) AS effects,
      (SELECT count(*) FROM m2_tool_effect_links) AS links
  `).get(), { invalidations: 1, pending: 0, grants: 0, effects: 0, links: 0 });
  assert.throws(
    () => createApprovalGrantIssuer(effectRepository, {
      clock: () => invalidatedAtMs,
      grantIdFactory: () => `grant:${'4'.repeat(64)}`,
      nonceFactory: () => '4'.repeat(32),
    }).issue({
      effectId: effectRequest.effectId,
      authenticatedSubject: { actorType: 'user', actorId: toolRequest.actor.id },
    }),
    error => error.code === 'EFFECT_AUTHORITY_STORAGE_FAILURE',
  );
  db.close();
});

test('failed effect projection is canonical and direct-SQL metadata forgeries are unreadable', () => {
  const canonical = failedFileWriteAuthority('8');
  assert.equal(canonical.toolRepository.recordToolResult(canonical.toolResult, {
    executionClaim: canonical.executionClaim,
  }).created, true);
  assert.deepEqual(
    canonical.toolRepository.getToolResult(canonical.toolRequest.requestId),
    canonical.toolResult,
  );
  canonical.db.close();

  const mutations = [
    value => ({ ...value, error: { ...value.error, code: 'FORGED_ERROR' } }),
    value => ({ ...value, error: { ...value.error, message: 'forged message' } }),
    value => ({ ...value, error: { ...value.error, retryable: true } }),
    value => ({ ...value, evidenceRefs: ['forged:evidence'] }),
    value => ({ ...value, lateCompletionRejected: true }),
    value => ({ ...value, startedAt: '2026-08-24T08:00:00.002Z' }),
    value => ({ ...value, completedAt: '2026-08-24T08:00:00.003Z' }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const fixture = failedFileWriteAuthority(String(index + 1));
    assert.throws(
      () => insertToolResultDirect(fixture.db, mutate(fixture.toolResult)),
      /M2_TOOL_LINKED_TERMINAL_PROJECTION_MISMATCH/,
      `forged failed-effect projection ${index + 1} must be rejected`,
    );
    fixture.db.close();
  }
});

summary();
