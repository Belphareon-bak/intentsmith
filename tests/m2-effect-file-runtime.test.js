import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import { createEffectFileRuntime } from '../src/effects/effect-file-runtime.js';
import { suite, testAsync, summary } from './harness.js';

void isolatedTestRuntime;

function openDatabase(filename) {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  applyEffectAuthorityMigration(database);
  return database;
}

async function withEnvironment(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-effect-runtime-'));
  const projectRoot = path.join(directory, 'project');
  const databasePath = path.join(directory, 'authority.sqlite');
  mkdirSync(path.join(projectRoot, 'notes'), { recursive: true });
  let database = openDatabase(databasePath);
  const workspaceAuthority = Object.freeze({
    async observe() {
      return Object.freeze({
        canonicalRoot: realpathSync(projectRoot),
        workspaceRevision: 'wsr1:runtime-integration',
      });
    },
  });
  const runtime = () => createEffectFileRuntime({ database, workspaceAuthority });

  try {
    await callback({
      projectRoot,
      databasePath,
      get database() { return database; },
      runtime,
      reopen() {
        database.close();
        database = openDatabase(databasePath);
      },
    });
  } finally {
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function requestInput(projectRoot, overrides = {}) {
  return {
    sessionId: 'session-1',
    conversationId: 'conversation-1',
    subjectId: 'local-operator',
    projectId: 17,
    projectRoot,
    relativePath: 'notes/result.md',
    content: 'Příliš žluťoučký kůň\n',
    ...overrides,
  };
}

suite('M2 durable filesystem effect runtime');

await testAsync('request persists exact pending bytes and exact approval is the only write path', async () => {
  await withEnvironment(async environment => {
    const runtime = environment.runtime();
    const input = requestInput(environment.projectRoot);
    const target = path.join(environment.projectRoot, input.relativePath);
    const prepared = await runtime.requestFilesystemWrite(input);

    assert.equal(prepared.state, 'approval_required');
    assert.equal(runtime.getPending(prepared.effectId).subjectId, input.subjectId);
    assert.equal(
      environment.database.prepare('SELECT payload_bytes AS bytes FROM m2_pending_effect_payloads').get().bytes,
      Buffer.byteLength(input.content, 'utf8'),
    );
    assert.throws(
      () => environment.database.prepare(
        'UPDATE m2_pending_effect_payloads SET subject_id = ? WHERE effect_id = ?',
      ).run('attacker', prepared.effectId),
      /append-only/,
    );
    assert.throws(
      () => environment.database.prepare(
        'DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?',
      ).run(prepared.effectId),
      /PAYLOAD_IS_ACTIVE/,
    );
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: prepared.effectId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        subjectId: 'attacker',
      }),
      error => error?.code === 'EFFECT_PENDING_NOT_FOUND',
    );
    assert.throws(() => readFileSync(target), /ENOENT/);

    const result = await runtime.approveFilesystemWrite({
      effectId: prepared.effectId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(readFileSync(target, 'utf8'), input.content);
    assert.equal(runtime.getPending(prepared.effectId), null);
    assert.deepEqual(
      environment.database.prepare(`
        SELECT event_type AS type FROM m2_effect_authority_events
        WHERE effect_id = ? ORDER BY seq
      `).all(prepared.effectId).map(row => row.type),
      ['REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED', 'RESULT_RECORDED'],
    );
  });
});

await testAsync('pending effect survives restart and remains bound to its original conversation and subject', async () => {
  await withEnvironment(async environment => {
    const input = requestInput(environment.projectRoot, {
      conversationId: 'conversation-restart',
      relativePath: 'notes/restart.md',
      content: 'restart durable\n',
    });
    const prepared = await environment.runtime().requestFilesystemWrite(input);
    environment.reopen();
    const restarted = environment.runtime();

    assert.equal(restarted.getPending(prepared.effectId).conversationId, input.conversationId);
    await assert.rejects(
      restarted.approveFilesystemWrite({
        effectId: prepared.effectId,
        sessionId: input.sessionId,
        conversationId: 'different-conversation',
        subjectId: input.subjectId,
      }),
      error => error?.code === 'EFFECT_PENDING_NOT_FOUND',
    );
    const result = await restarted.approveFilesystemWrite({
      effectId: prepared.effectId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(
      readFileSync(path.join(environment.projectRoot, input.relativePath), 'utf8'),
      input.content,
    );
    assert.equal(restarted.getPending(prepared.effectId), null);
  });
});

summary();
