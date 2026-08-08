// C3-Agent v56.0 — Sprint 3 Tests: Persistence & Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// T9.1: ConversationStore CRUD
// T9.2: Session restart survival (real process + SQLite)
// T9.3: LTM Context Builder
// T9.4: Invariant enforcement
// T9.5: Endpoint session contract
//
// Spuštění: node --experimental-vm-modules tests/chat-persistence.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { validateConversationResult } from '../contracts/m1/index.js';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingTests = [];

function describe(name, fn) {
  pendingTests.push(async () => {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'═'.repeat(70)}`);
    await fn();
  });
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  ConversationStore,
  TurnRole,
  resetConversationStore,
} from '../src/chat/conversation-store.js';

import {
  extractLTMContext,
  buildLTMPromptBlock,
  getLTMContextForSynthesis,
} from '../src/chat/ltm-context.js';

import { MemoryKind, LongTermMemory } from '../src/memory/long-term.js';

const SERVER_START_TIMEOUT_MS = 60_000;
const SERVER_STOP_TIMEOUT_MS = 15_000;
const ownedServerChildren = new Set();

// `process.exit()` does not wait for child processes. Keep this synchronous
// backstop so a failed direct test cannot orphan a server after its result is
// printed. Normal test control still uses stopOwnedServer() and asserts a
// graceful exit.
process.once('exit', () => {
  for (const child of ownedServerChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  }
});

function boundedTail(value, chunk) {
  return (value + String(chunk)).slice(-20_000);
}

function ownedServerEnvironment(nonce) {
  return {
    PATH: process.env.PATH || '',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    HOME: isolatedTestRuntime.home,
    XDG_CONFIG_HOME: isolatedTestRuntime.xdgConfig,
    XDG_CACHE_HOME: isolatedTestRuntime.xdgCache,
    XDG_DATA_HOME: isolatedTestRuntime.xdgData,
    XDG_STATE_HOME: isolatedTestRuntime.xdgState,
    TMPDIR: isolatedTestRuntime.temp,
    TMP: isolatedTestRuntime.temp,
    TEMP: isolatedTestRuntime.temp,
    npm_config_cache: isolatedTestRuntime.npmCache,
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: `${isolatedTestRuntime.runtime}/no-dotenv-file`,
    DOTENV_CONFIG_QUIET: 'true',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: isolatedTestRuntime.portFile,
    C3_DB_PATH: isolatedTestRuntime.database,
    C3_PROJECTS_DIR: isolatedTestRuntime.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: isolatedTestRuntime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: isolatedTestRuntime.artifacts,
    INTENTSMITH_TEST_SERVER_NONCE: nonce,
    C3_CORS_ORIGINS: 'http://localhost:3000',
    C3_ENABLE_AGENTS: 'false',
    C3_ENABLE_EXPERTISES: 'false',
    C3_ENABLE_LIFECYCLE: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_SKILLS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_TRACE: '0',
    C3_LOG_LEVEL: 'warn',
    OLLAMA_URL: 'invalid://m1-chat-restart-no-provider',
  };
}

async function startOwnedServer(nonce) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: isolatedTestRuntime.repositoryRoot,
    env: ownedServerEnvironment(nonce),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = {
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    port: null,
    capability: null,
  };
  ownedServerChildren.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    state.stdout = boundedTail(state.stdout, chunk);
  });
  child.stderr.on('data', chunk => {
    state.stderr = boundedTail(state.stderr, chunk);
  });
  child.on('exit', (code, signal) => {
    state.exitCode = code;
    state.signal = signal;
    ownedServerChildren.delete(child);
  });

  try {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (state.exitCode !== null || state.signal !== null) {
        throw new Error(
          `owned server exited before readiness: ${state.stdout} ${state.stderr}`
            .trim().slice(-2_000),
        );
      }
      if (existsSync(isolatedTestRuntime.portFile)) {
        try {
          const payload = JSON.parse(readFileSync(isolatedTestRuntime.portFile, 'utf8'));
          if (
            payload.pid === child.pid
            && payload.testRunNonce === nonce
            && Number.isInteger(payload.port)
            && payload.port > 0
            && /^[A-Za-z0-9_-]{43}$/.test(payload.localCapability || '')
          ) {
            state.port = payload.port;
            state.capability = payload.localCapability;
            return state;
          }
        } catch {
          // Port file can be observed between the atomic write and JSON parse.
        }
      }
      await delay(25);
    }
    throw new Error(
      `timed out waiting for owned server: ${state.stdout} ${state.stderr}`
        .trim().slice(-2_000),
    );
  } catch (error) {
    try {
      await stopOwnedServer(state);
    } catch (stopError) {
      error.message += `; cleanup failed: ${stopError.message}`;
    }
    throw error;
  }
}

async function stopOwnedServer(state) {
  if (!state?.child || state.exitCode !== null || state.signal !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
  while (
    Date.now() < deadline
    && state.exitCode === null
    && state.signal === null
  ) {
    await delay(25);
  }
  if (state.exitCode === null && state.signal === null) {
    state.child.kill('SIGKILL');
    while (state.exitCode === null && state.signal === null) await delay(10);
    throw new Error('owned server required SIGKILL instead of graceful shutdown');
  }
  assert.equal(state.exitCode, 0, `owned server exit: ${state.stderr.slice(-1000)}`);
}

function requestOwnedServer(state, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const encoded = body === null ? null : JSON.stringify(body);
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: state.port,
      path: pathname,
      method,
      headers: {
        'X-IntentSmith-Local-Capability': state.capability,
        ...(encoded === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(encoded),
        }),
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        raw += chunk;
        if (raw.length > 1_000_000) {
          request.destroy(new Error('owned response exceeded 1 MB'));
        }
      });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* asserted by caller */ }
        resolve({ statusCode: response.statusCode, json, raw });
      });
    });
    request.setTimeout(10_000, () => {
      request.destroy(new Error(`owned ${method} ${pathname} timed out`));
    });
    request.on('error', reject);
    if (encoded !== null) request.write(encoded);
    request.end();
  });
}

function exactMessages(response, conversationId) {
  assert.equal(response.statusCode, 200, response.raw);
  assert.ok(Array.isArray(response.json?.messages), 'messages response must be an array');
  assert.ok(
    response.json.messages.every(message => message.conversation_id === conversationId),
    'every restored message must remain owned by its conversation',
  );
  return response.json.messages;
}


// ══════════════════════════════════════════════════════════════════════════════
// T9.1: CONVERSATION STORE CRUD
// ══════════════════════════════════════════════════════════════════════════════

describe('T9.1: ConversationStore CRUD', () => {

  it('ensureConversation creates new conversation', async () => {
    const store = new ConversationStore(null); // in-memory mode
    const result = store.ensureConversation('conv-001');
    assert.equal(result.id, 'conv-001');
    assert.equal(result.isNew, true);
  });

  it('ensureConversation is idempotent', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-002');
    const result = store.ensureConversation('conv-002');
    assert.equal(result.id, 'conv-002');
    assert.equal(result.isNew, false);
  });

  it('appendTurn persists immediately', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-003');
    const result = store.appendTurn('conv-003', TurnRole.USER, 'Ahoj');
    assert.ok(result.id > 0, 'Should return positive ID');
    assert.equal(result.persisted, true);

    const turns = store.getRecentTurns('conv-003');
    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, 'Ahoj');
    assert.equal(turns[0].role, 'user');
  });

  it('appendTurn auto-creates conversation if missing', async () => {
    const store = new ConversationStore(null);
    // No ensureConversation call — should auto-create
    store.appendTurn('conv-auto', TurnRole.USER, 'Test');
    const conv = store.getConversation('conv-auto');
    assert.ok(conv, 'Conversation should be auto-created');
    assert.equal(conv.id, 'conv-auto');
  });

  it('getRecentTurns returns chronological order', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-004');
    store.appendTurn('conv-004', TurnRole.USER, 'First');
    store.appendTurn('conv-004', TurnRole.ASSISTANT, 'Second');
    store.appendTurn('conv-004', TurnRole.USER, 'Third');

    const turns = store.getRecentTurns('conv-004', 10);
    assert.equal(turns.length, 3);
    assert.equal(turns[0].content, 'First');
    assert.equal(turns[1].content, 'Second');
    assert.equal(turns[2].content, 'Third');
  });

  it('getRecentTurns respects limit (returns LAST N)', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-005');
    for (let i = 1; i <= 20; i++) {
      store.appendTurn('conv-005', TurnRole.USER, `Message ${i}`);
    }

    const turns = store.getRecentTurns('conv-005', 5);
    assert.equal(turns.length, 5);
    assert.equal(turns[0].content, 'Message 16'); // oldest of last 5
    assert.equal(turns[4].content, 'Message 20'); // newest
  });

  it('getTurnCount is accurate', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-006');
    assert.equal(store.getTurnCount('conv-006'), 0);

    store.appendTurn('conv-006', TurnRole.USER, 'One');
    store.appendTurn('conv-006', TurnRole.ASSISTANT, 'Two');
    assert.equal(store.getTurnCount('conv-006'), 2);
  });

  it('getAllTurns returns complete conversation', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-007');
    store.appendTurn('conv-007', TurnRole.USER, 'Start');
    store.appendTurn('conv-007', TurnRole.ASSISTANT, 'Reply');
    store.appendTurn('conv-007', TurnRole.USER, 'Follow-up');

    const all = store.getAllTurns('conv-007');
    assert.equal(all.length, 3);
    assert.equal(all[0].role, 'user');
    assert.equal(all[2].role, 'user');
  });

  it('setTitle updates conversation title', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-008');
    store.setTitle('conv-008', 'My Conversation');

    const conv = store.getConversation('conv-008');
    assert.equal(conv.title, 'My Conversation');
  });

  it('exists() returns correct boolean', async () => {
    const store = new ConversationStore(null);
    assert.equal(store.exists('nope'), false);
    store.ensureConversation('yep');
    assert.equal(store.exists('yep'), true);
  });

  it('listRecent returns conversations sorted by updated_at', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-old');
    // Manually set older timestamp
    store._memConversations.get('conv-old').updated_at = '2020-01-01T00:00:00.000Z';

    store.ensureConversation('conv-new');
    store.appendTurn('conv-new', TurnRole.USER, 'Activity');
    // conv-new has updated_at from appendTurn which is recent

    const recent = store.listRecent(10);
    assert.ok(recent.length >= 2);
    // conv-new should be first (most recently updated)
    assert.equal(recent[0].id, 'conv-new');
  });

  it('appendTurn stores metadata as JSON', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('conv-meta');
    store.appendTurn('conv-meta', TurnRole.ASSISTANT, 'Response', {
      model: 'test-model',
      confidence: 0.85,
      intent: 'SEARCH',
    });

    const turns = store.getRecentTurns('conv-meta', 1);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].metadata.model, 'test-model');
    assert.equal(turns[0].metadata.confidence, 0.85);
    assert.equal(turns[0].metadata.intent, 'SEARCH');
  });

  it('conversations are isolated (no cross-contamination)', async () => {
    const store = new ConversationStore(null);
    store.appendTurn('conv-A', TurnRole.USER, 'Message A');
    store.appendTurn('conv-B', TurnRole.USER, 'Message B');

    const turnsA = store.getRecentTurns('conv-A');
    const turnsB = store.getRecentTurns('conv-B');
    assert.equal(turnsA.length, 1);
    assert.equal(turnsB.length, 1);
    assert.equal(turnsA[0].content, 'Message A');
    assert.equal(turnsB[0].content, 'Message B');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T9.2: SESSION RESTART SURVIVAL
// ══════════════════════════════════════════════════════════════════════════════

describe('T9.2: Session restart survival (real process + SQLite)', async () => {

  await it('two chats survive a real backend stop/start with exact durable turns', async () => {
    const conversationA = 'm1-restart-conversation-A';
    const conversationB = 'm1-restart-conversation-B';
    let firstServer = null;
    let secondServer = null;
    let firstServerPid = null;

    try {
      firstServer = await startOwnedServer('m1-chat-restart-first-000000000001');
      firstServerPid = firstServer.child.pid;
      const commandA = {
        contract: 'ConversationCommand',
        version: 1,
        requestId: 'm1-restart-request-A',
        conversationId: conversationA,
        turnId: 'm1-restart-turn-A',
        action: 'send',
        input: 'kolik je 17 * 23?',
      };
      const commandB = {
        contract: 'ConversationCommand',
        version: 1,
        requestId: 'm1-restart-request-B',
        conversationId: conversationB,
        turnId: 'm1-restart-turn-B',
        action: 'send',
        input: 'kolik je 2 + 2?',
      };

      const startedAt = performance.now();
      const responseA = await requestOwnedServer(firstServer, 'POST', '/api/chat', commandA);
      const deterministicLatencyMs = performance.now() - startedAt;
      assert.equal(responseA.statusCode, 200, responseA.raw);
      assert.equal(validateConversationResult(responseA.json).valid, true);
      assert.equal(responseA.json.status, 'ok');
      assert.ok(responseA.json.response.content.includes('391'));
      assert.ok(
        deterministicLatencyMs < 100,
        `deterministic HTTP latency ${deterministicLatencyMs.toFixed(1)}ms must be <100ms`,
      );
      console.log(`     deterministic HTTP latency: ${deterministicLatencyMs.toFixed(1)}ms`);

      const responseB = await requestOwnedServer(firstServer, 'POST', '/api/chat', commandB);
      assert.equal(responseB.statusCode, 200, responseB.raw);
      assert.equal(validateConversationResult(responseB.json).valid, true);
      assert.equal(responseB.json.status, 'ok');
      assert.ok(responseB.json.response.content.includes('4'));

      const beforeA = exactMessages(
        await requestOwnedServer(
          firstServer,
          'GET',
          `/api/conversations/${encodeURIComponent(conversationA)}/messages`,
        ),
        conversationA,
      );
      const beforeB = exactMessages(
        await requestOwnedServer(
          firstServer,
          'GET',
          `/api/conversations/${encodeURIComponent(conversationB)}/messages`,
        ),
        conversationB,
      );
      assert.deepEqual(beforeA.map(message => message.role), ['user', 'assistant']);
      assert.deepEqual(beforeB.map(message => message.role), ['user', 'assistant']);
      assert.equal(beforeA.some(message => message.content === commandB.input), false);
      assert.equal(beforeB.some(message => message.content === commandA.input), false);

      await stopOwnedServer(firstServer);
      firstServer = null;
      assert.equal(existsSync(isolatedTestRuntime.portFile), false);

      secondServer = await startOwnedServer('m1-chat-restart-second-00000000002');
      assert.notEqual(secondServer.child.pid, firstServerPid, 'restart must use a new OS process');
      const afterA = exactMessages(
        await requestOwnedServer(
          secondServer,
          'GET',
          `/api/conversations/${encodeURIComponent(conversationA)}/messages`,
        ),
        conversationA,
      );
      const afterB = exactMessages(
        await requestOwnedServer(
          secondServer,
          'GET',
          `/api/conversations/${encodeURIComponent(conversationB)}/messages`,
        ),
        conversationB,
      );
      assert.deepEqual(afterA, beforeA);
      assert.deepEqual(afterB, beforeB);
    } finally {
      await stopOwnedServer(firstServer);
      await stopOwnedServer(secondServer);
    }
  });

  await it('buildHandlerHistory format matches handler expectations', async () => {
    const store = new ConversationStore(null);
    store.appendTurn('format-test', TurnRole.USER, 'Question');
    store.appendTurn('format-test', TurnRole.ASSISTANT, 'Answer');

    const history = store.buildHandlerHistory('format-test', 10);

    // Handler expects: [{ response: { tag: { speaker }, content }, timestamp }]
    assert.equal(history.length, 2);
    assert.ok(history[0].response, 'Should have response object');
    assert.ok(history[0].response.tag, 'Should have tag');
    assert.ok(history[0].response.tag.speaker, 'Should have speaker');
    assert.ok(history[0].response.content, 'Should have content');
    assert.ok(history[0].timestamp, 'Should have timestamp');

    // User role maps to 'user', assistant maps to 'system'
    assert.equal(history[0].response.tag.speaker, 'user');
    assert.equal(history[1].response.tag.speaker, 'system');
  });

  await it('buildHistoryContext produces LLM-ready string', async () => {
    const store = new ConversationStore(null);
    store.appendTurn('ctx-test', TurnRole.USER, 'Jaké je počasí?');
    store.appendTurn('ctx-test', TurnRole.ASSISTANT, 'Dnes je slunečno.');
    store.appendTurn('ctx-test', TurnRole.USER, 'A zítra?');

    const ctx = store.buildHistoryContext('ctx-test', 5);
    assert.ok(ctx.includes('user: Jaké je počasí?'));
    assert.ok(ctx.includes('assistant: Dnes je slunečno.'));
    assert.ok(ctx.includes('user: A zítra?'));
  });

  await it('buildHistoryContext returns empty string for no history', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('empty-conv');
    const ctx = store.buildHistoryContext('empty-conv');
    assert.equal(ctx, '');
  });

  await it('buildHistoryContext limits turns', async () => {
    const store = new ConversationStore(null);
    for (let i = 1; i <= 10; i++) {
      store.appendTurn('limit-ctx', TurnRole.USER, `Turn ${i}`);
    }

    const ctx = store.buildHistoryContext('limit-ctx', 3);
    const lines = ctx.split('\n').filter(l => l.trim());
    assert.equal(lines.length, 3);
    assert.ok(ctx.includes('Turn 8'));
    assert.ok(ctx.includes('Turn 10'));
    assert.ok(!ctx.includes('Turn 7'));
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T9.3: LTM CONTEXT BUILDER
// ══════════════════════════════════════════════════════════════════════════════

describe('T9.3: LTM Context Builder', () => {

  // Helper: create a mock LTM with queryByKind support
  function createMockLTM(entries) {
    const ltm = new LongTermMemory({ userId: 'test-user' });
    // Store entries matching the in-memory schema queryByKind expects
    for (const entry of entries) {
      ltm.store.set(`${entry.kind}::${entry.key}`, {
        userId: 'test-user',  // queryByKind filters by this
        kind: entry.kind,
        key: entry.key,
        value: entry.value,
        confidence: entry.confidence ?? 1.0,
        source: entry.source ?? 'explicit',
        createdAt: Date.now(),
        ttl: null,
      });
    }
    return ltm;
  }

  it('extractLTMContext returns empty for null LTM', async () => {
    const result = extractLTMContext(null);
    assert.deepEqual(result, { facts: [], count: 0 });
  });

  it('extractLTMContext filters by minConfidence', async () => {
    const ltm = createMockLTM([
      { kind: MemoryKind.PREFERENCE, key: 'verbose', value: true, confidence: 0.9 },
      { kind: MemoryKind.PREFERENCE, key: 'dark-mode', value: true, confidence: 0.3 },
    ]);

    const result = extractLTMContext(ltm, { minConfidence: 0.6 });
    assert.equal(result.count, 1);
    assert.equal(result.facts[0].key, 'verbose');
  });

  it('extractLTMContext respects maxFacts limit', async () => {
    const ltm = createMockLTM([
      { kind: MemoryKind.PREFERENCE, key: 'a', value: 1, confidence: 0.9 },
      { kind: MemoryKind.PREFERENCE, key: 'b', value: 2, confidence: 0.8 },
      { kind: MemoryKind.PREFERENCE, key: 'c', value: 3, confidence: 0.7 },
      { kind: MemoryKind.PREFERENCE, key: 'd', value: 4, confidence: 0.6 },
    ]);

    const result = extractLTMContext(ltm, { maxFacts: 2, minConfidence: 0.5 });
    assert.equal(result.count, 2);
    // Should be sorted by confidence, highest first
    assert.equal(result.facts[0].key, 'a');
    assert.equal(result.facts[1].key, 'b');
  });

  it('buildLTMPromptBlock formats preferences correctly', async () => {
    const block = buildLTMPromptBlock([
      { kind: MemoryKind.PREFERENCE, key: 'verbose', value: true },
      { kind: MemoryKind.STYLE, key: 'style', value: 'stručně a věcně' },
      { kind: MemoryKind.PROJECT, key: 'c3-agent', value: 'Node.js orchestrátor' },
    ]);

    assert.ok(block.includes('KONTEXT O UŽIVATELI'));
    assert.ok(block.includes('Preference: verbose'));
    assert.ok(block.includes('Styl: stručně a věcně'));
    assert.ok(block.includes('Projekt: c3-agent'));
  });

  it('buildLTMPromptBlock returns empty string for no facts', async () => {
    assert.equal(buildLTMPromptBlock([]), '');
    assert.equal(buildLTMPromptBlock(null), '');
  });

  it('getLTMContextForSynthesis end-to-end', async () => {
    const ltm = createMockLTM([
      { kind: MemoryKind.PREFERENCE, key: 'name', value: 'Petr', confidence: 1.0 },
      { kind: MemoryKind.STYLE, key: 'style', value: 'stručně', confidence: 0.8 },
    ]);

    const ctx = getLTMContextForSynthesis(ltm);
    assert.ok(ctx.includes('Petr'));
    assert.ok(ctx.includes('stručně'));
    assert.ok(ctx.includes('KONTEXT O UŽIVATELI'));
  });

  it('getLTMContextForSynthesis returns empty for null LTM', async () => {
    assert.equal(getLTMContextForSynthesis(null), '');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T9.4: INVARIANT ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('T9.4: Invariant enforcement', () => {

  it('appendTurn throws on missing conversationId', async () => {
    const store = new ConversationStore(null);
    assert.throws(
      () => store.appendTurn(null, TurnRole.USER, 'test'),
      /conversationId is required/
    );
    assert.throws(
      () => store.appendTurn('', TurnRole.USER, 'test'),
      /conversationId is required/
    );
  });

  it('appendTurn throws on invalid role', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('inv-role');
    assert.throws(
      () => store.appendTurn('inv-role', 'INVALID_ROLE', 'test'),
      /invalid role/
    );
  });

  it('appendTurn throws on empty content', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('inv-content');
    assert.throws(
      () => store.appendTurn('inv-content', TurnRole.USER, ''),
      /content must be a non-empty string/
    );
    assert.throws(
      () => store.appendTurn('inv-content', TurnRole.USER, null),
      /content must be a non-empty string/
    );
  });

  it('ensureConversation throws on non-string ID', async () => {
    const store = new ConversationStore(null);
    assert.throws(
      () => store.ensureConversation(12345),
      /must be a string/
    );
    assert.throws(
      () => store.ensureConversation(null),
      /required/
    );
  });

  it('TurnRole is frozen (no accidental modification)', async () => {
    assert.throws(() => {
      TurnRole.ADMIN = 'admin';
    }, /Cannot add property|Cannot assign to read only/);
  });

  it('LTM context does NOT contain routing instructions', async () => {
    // Verify LTM output is pure context, no "use intent X" or "route to mode Y"
    const ltm = new LongTermMemory({ userId: 'test' });
    ltm.store.set('preference::verbose', {
      userId: 'test',
      kind: MemoryKind.PREFERENCE, key: 'verbose', value: true, confidence: 1.0,
      createdAt: Date.now(), ttl: null,
    });

    const ctx = getLTMContextForSynthesis(ltm);
    // Should NOT contain routing keywords
    const routingPatterns = [
      /intent/i, /route/i, /mode.*switch/i, /SEARCH|REPORT|FACTUAL/,
      /DecisionType/i, /handleTool/i,
    ];
    for (const pattern of routingPatterns) {
      assert.ok(!pattern.test(ctx),
        `LTM context should not contain routing hint: ${pattern}`);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T9.5: ENDPOINT SESSION CONTRACT
// ══════════════════════════════════════════════════════════════════════════════

describe('T9.5: Endpoint session contract', () => {

  it('ConversationStore singleton can be reset (for test isolation)', async () => {
    resetConversationStore();
    // After reset, importing getConversationStore should create fresh instance
    const { getConversationStore } = await import('../src/chat/conversation-store.js');
    const store = getConversationStore(); // null db = in-memory
    assert.ok(store instanceof ConversationStore);
    // Clean up
    resetConversationStore();
  });

  it('Multiple conversations tracked independently in same store', async () => {
    const store = new ConversationStore(null);

    // Simulate two parallel sessions
    store.appendTurn('session-A', TurnRole.USER, 'Hello from A');
    store.appendTurn('session-B', TurnRole.USER, 'Hello from B');
    store.appendTurn('session-A', TurnRole.ASSISTANT, 'Reply to A');
    store.appendTurn('session-B', TurnRole.ASSISTANT, 'Reply to B');

    const histA = store.getRecentTurns('session-A');
    const histB = store.getRecentTurns('session-B');

    assert.equal(histA.length, 2);
    assert.equal(histB.length, 2);
    assert.ok(histA.every(t => t.content.includes('A')));
    assert.ok(histB.every(t => t.content.includes('B')));
  });

  it('ConversationStore with project association', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('proj-conv', { projectId: 42 });

    const conv = store.getConversation('proj-conv');
    assert.equal(conv.project_id, 42);
  });

  it('listRecent filters by project', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('p-conv-1', { projectId: 10 });
    store.ensureConversation('p-conv-2', { projectId: 20 });
    store.ensureConversation('p-conv-3', { projectId: 10 });

    const proj10 = store.listRecent(10, { projectId: 10 });
    assert.equal(proj10.length, 2);
    assert.ok(proj10.every(c => c.project_id === 10));
  });

  it('Turn ordering is consistent across multiple appendTurn calls', async () => {
    const store = new ConversationStore(null);
    const convId = 'order-test';

    // Rapid fire 10 messages
    for (let i = 0; i < 10; i++) {
      const role = i % 2 === 0 ? TurnRole.USER : TurnRole.ASSISTANT;
      store.appendTurn(convId, role, `Msg-${i}`);
    }

    const turns = store.getAllTurns(convId);
    assert.equal(turns.length, 10);

    // IDs should be monotonically increasing
    for (let i = 1; i < turns.length; i++) {
      assert.ok(turns[i].id > turns[i - 1].id,
        `Turn ${i} ID should be > turn ${i-1} ID`);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ══════════════════════════════════════════════════════════════════════════════

for (const test of pendingTests) {
  await test();
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(70)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
}

process.exit(failed > 0 ? 1 : 0);
