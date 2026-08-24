#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { suite, test, summary } from './harness.js';
import {
  M2_TOOL_CONTRACT_KIND,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
} from '../contracts/m2/tool-v1.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import { up as applyEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import {
  EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT,
  computeToolV1SchemaFingerprint,
  up as applyToolAuthority,
} from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import {
  M2ToolAuthorityErrorCode,
  M2ToolAuthorityRepository,
} from '../src/tools/m2-tool-authority-repository.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';

function database() {
  const value = new Database(':memory:');
  value.pragma('foreign_keys = ON');
  applyEffectAuthority(value);
  applyEffectHardening(value);
  applyEffectClaims(value);
  applyEffectClaimTruth(value);
  applyToolAuthority(value);
  return value;
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
    inputSchema: 'intentsmith.tool.local-math.input@1',
    input,
    inputDigest: computeM2ToolValueDigest(input),
    requiredEffectKind: null,
    timeoutMs: 30_000,
    idempotencyKey: `tool-operation:${'e'.repeat(64)}`,
    createdAt: '2026-08-24T08:00:00.000Z',
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

suite('M2 durable tool authority — request and exact replay');

test('migration installs append-only request/result tables without changing effect fingerprint scope', () => {
  const db = database();
  const names = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE name LIKE 'tool_v1_%' OR name LIKE 'trg_tool_v1_%'
    ORDER BY name
  `).all().map(row => row.name);
  assert.equal(names.includes('tool_v1_requests'), true);
  assert.equal(names.includes('tool_v1_results'), true);
  assert.equal(names.includes('trg_tool_v1_results_exact_effect'), true);
  assert.equal(computeToolV1SchemaFingerprint(db), EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT);
  applyToolAuthority(db);
  assert.equal(computeToolV1SchemaFingerprint(db), EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT);
  db.close();
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
  const repository = new M2ToolAuthorityRepository(db);
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
  const repository = new M2ToolAuthorityRepository(db);
  const value = request();
  repository.registerToolRequest(value);
  assert.throws(
    () => repository.registerToolRequest({ ...value, requestId: `tool:${'f'.repeat(64)}` }),
    error => error.code === M2ToolAuthorityErrorCode.REQUEST_CONFLICT,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM tool_v1_requests').get().count, 1);
  db.close();
});

suite('M2 durable tool authority — immutable terminal truth');

test('one exact terminal is durable and duplicate commit is idempotent', () => {
  const db = database();
  const repository = new M2ToolAuthorityRepository(db);
  const toolRequest = request();
  const toolResult = result(toolRequest);
  repository.registerToolRequest(toolRequest);
  assert.equal(repository.recordToolResult(toolResult).created, true);
  assert.equal(repository.recordToolResult(toolResult).created, false);
  assert.deepEqual(repository.getToolResult(toolRequest.requestId), toolResult);
  db.close();
});

test('conflicting terminal and mismatched request digest are rejected', () => {
  const db = database();
  const repository = new M2ToolAuthorityRepository(db);
  const toolRequest = request();
  const toolResult = result(toolRequest);
  repository.registerToolRequest(toolRequest);
  repository.recordToolResult(toolResult);
  assert.throws(
    () => repository.recordToolResult(result(toolRequest, {
      output: { subtype: 'math', expression: '2+2', result: 5 },
      outputDigest: computeM2ToolValueDigest({ subtype: 'math', expression: '2+2', result: 5 }),
    })),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_CONFLICT,
  );
  const mismatchDb = database();
  const mismatchRepository = new M2ToolAuthorityRepository(mismatchDb);
  mismatchRepository.registerToolRequest(toolRequest);
  const wrongDigest = { ...toolResult, requestDigest: `sha256:${'0'.repeat(64)}` };
  assert.throws(
    () => mismatchRepository.recordToolResult(wrongDigest),
    error => error.code === M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
  );
  mismatchDb.close();
  db.close();
});

test('append-only triggers reject direct mutation and deletion', () => {
  const db = database();
  const repository = new M2ToolAuthorityRepository(db);
  const toolRequest = request();
  repository.registerToolRequest(toolRequest);
  repository.recordToolResult(result(toolRequest));
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

test('effectful ToolResult success is rejected until canonical EffectResult is durable', () => {
  const db = database();
  const toolRepository = new M2ToolAuthorityRepository(db);
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
    payloadDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
    payloadBytes: payload.length,
    workspaceRevision: 'wsr1:test-revision',
    requiredCapability: 'project.fs.write',
    riskClass: 'write',
    timeoutMs: 30_000,
    idempotencyKey: `effect-operation:${'1'.repeat(64)}`,
    approvalGrantId: null,
    createdAt: '2026-08-24T08:00:00.000Z',
  };
  toolRepository.registerToolRequest(toolRequest);
  effectRepository.registerEffectRequest(effectRequest);
  const output = {
    path: toolInput.path,
    effectId: effectRequest.effectId,
    terminalStatus: 'succeeded',
  };
  const toolResult = result(toolRequest, {
    output,
    outputSchema: 'intentsmith.tool.file-write.output@1',
    outputDigest: computeM2ToolValueDigest(output),
    effectRequestId: effectRequest.effectId,
  });
  assert.throws(
    () => toolRepository.recordToolResult(toolResult),
    error => error.code === M2ToolAuthorityErrorCode.STORAGE_FAILURE
      && /SUCCESS_EFFECT_AUTHORITY_MISSING/.test(error.details?.cause || ''),
  );
  assert.equal(toolRepository.getToolResult(toolRequest.requestId), null);
  db.close();
});

summary();
