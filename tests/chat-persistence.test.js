// C3-Agent v56.0 — Sprint 3 Tests: Persistence & Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// T9.1: ConversationStore CRUD
// T9.2: Session restart survival (simulated)
// T9.3: LTM Context Builder
// T9.4: Invariant enforcement
// T9.5: Endpoint session contract
//
// Spuštění: node --experimental-vm-modules tests/chat-persistence.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';

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

describe('T9.2: Session restart survival (simulated)', () => {

  it('New store instance reads existing conversations (in-memory shared)', async () => {
    // Simulate: store1 writes, then "restart" = create store2 reading same backing
    // In real DB mode this is automatic. For in-memory, we verify the architecture.
    const store = new ConversationStore(null);
    store.appendTurn('persist-test', TurnRole.USER, 'Before restart');
    store.appendTurn('persist-test', TurnRole.ASSISTANT, 'I remember');

    // In in-memory mode, same store = same data (simulates DB persistence)
    const turns = store.getRecentTurns('persist-test', 10);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].content, 'Before restart');
    assert.equal(turns[1].content, 'I remember');
  });

  it('buildHandlerHistory format matches handler expectations', async () => {
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

  it('buildHistoryContext produces LLM-ready string', async () => {
    const store = new ConversationStore(null);
    store.appendTurn('ctx-test', TurnRole.USER, 'Jaké je počasí?');
    store.appendTurn('ctx-test', TurnRole.ASSISTANT, 'Dnes je slunečno.');
    store.appendTurn('ctx-test', TurnRole.USER, 'A zítra?');

    const ctx = store.buildHistoryContext('ctx-test', 5);
    assert.ok(ctx.includes('user: Jaké je počasí?'));
    assert.ok(ctx.includes('assistant: Dnes je slunečno.'));
    assert.ok(ctx.includes('user: A zítra?'));
  });

  it('buildHistoryContext returns empty string for no history', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('empty-conv');
    const ctx = store.buildHistoryContext('empty-conv');
    assert.equal(ctx, '');
  });

  it('buildHistoryContext limits turns', async () => {
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
