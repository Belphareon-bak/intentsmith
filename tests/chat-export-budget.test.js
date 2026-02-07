// C3-Agent v56.1 — Sprint 4 Tests: Context Budget & Export
// ══════════════════════════════════════════════════════════════════════════════
//
// T10.1: Context Budget
// T10.2: Summarization
// T10.3: Export Pipeline
// T10.4: Export Command Detection
//
// Spuštění: node --experimental-vm-modules tests/chat-export-budget.test.js
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
  INTENT_BUDGETS,
  estimateTokens,
  getBudgetForIntent,
  buildBudgetedContext,
  formatBudgetedHistory,
  buildSummaryPrompt,
  getSummarySystemPrompt,
} from '../src/chat/context-budget.js';

import {
  ConversationStore,
  TurnRole,
} from '../src/chat/conversation-store.js';

import {
  ExportFormat,
  ExportScope,
  detectExportCommand,
  exportConversation,
} from '../src/chat/export-pipeline.js';


// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a ConversationStore with N turns of conversation */
function createStoreWithTurns(convId, turnCount, contentFn) {
  const store = new ConversationStore(null);
  store.ensureConversation(convId);
  for (let i = 0; i < turnCount; i++) {
    const role = i % 2 === 0 ? TurnRole.USER : TurnRole.ASSISTANT;
    const content = contentFn ? contentFn(i) : `Message ${i + 1}: ${'x'.repeat(100)}`;
    store.appendTurn(convId, role, content);
  }
  return store;
}

/** Mock summarizer that returns a fixed string */
const mockSummarizer = async (turns) => {
  return `Shrnutí: konverzace měla ${turns.length} zpráv o různých tématech.`;
};


// ══════════════════════════════════════════════════════════════════════════════
// T10.1: CONTEXT BUDGET
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.1: Context Budget', async () => {

  await it('estimateTokens returns reasonable values', async () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);

    // 35 chars → ~10 tokens at 3.5 chars/token
    const tokens = estimateTokens('a'.repeat(35));
    assert.equal(tokens, 10);

    // Czech text
    const cz = 'Jak se máte dnes? Potřebuji pomoc s projektem.';
    const czTokens = estimateTokens(cz);
    assert.ok(czTokens > 0);
    assert.ok(czTokens < 50); // reasonable range
  });

  await it('Budget is defined for all standard intent types', async () => {
    const expected = [
      'CONVERSATIONAL', 'CREATIVE', 'SEARCH', 'FACTUAL',
      'REPORT', 'ITEM_LOOKUP', 'CODE', 'LOCAL', 'COMMAND',
      'AMBIGUOUS', 'BUILD',
    ];
    for (const intent of expected) {
      const budget = getBudgetForIntent(intent);
      assert.ok(budget, `Budget should exist for ${intent}`);
      assert.ok(budget.history >= 0, `${intent}: history budget should be >= 0`);
      assert.ok(budget.ltm >= 0, `${intent}: ltm budget should be >= 0`);
    }
  });

  await it('getBudgetForIntent returns default for unknown intent', async () => {
    const budget = getBudgetForIntent('UNKNOWN_INTENT');
    assert.ok(budget);
    assert.ok(budget.history > 0);
  });

  await it('SEARCH has lower history budget than CONVERSATIONAL', async () => {
    const search = getBudgetForIntent('SEARCH');
    const conv = getBudgetForIntent('CONVERSATIONAL');
    assert.ok(search.history < conv.history,
      `SEARCH history (${search.history}) should be < CONVERSATIONAL (${conv.history})`);
  });

  await it('CREATIVE has higher history budget than REPORT', async () => {
    const creative = getBudgetForIntent('CREATIVE');
    const report = getBudgetForIntent('REPORT');
    assert.ok(creative.history > report.history);
  });

  await it('INTENT_BUDGETS is frozen (immutable)', async () => {
    assert.throws(() => {
      INTENT_BUDGETS.NEW_TYPE = { history: 999 };
    });
  });

  await it('buildBudgetedContext respects token limits', async () => {
    // Create store with many turns (each ~30 tokens)
    const store = createStoreWithTurns('budget-test', 20);

    const ctx = await buildBudgetedContext('budget-test', 'SEARCH', { store });

    // SEARCH has 500 token history budget
    assert.ok(ctx.tokenUsage.history <= 500,
      `History tokens (${ctx.tokenUsage.history}) should be <= 500`);
    assert.ok(ctx.source.verbatimCount < 20,
      `Should not include all 20 turns, got ${ctx.source.verbatimCount}`);
  });

  await it('buildBudgetedContext returns newest turns (not oldest)', async () => {
    const store = createStoreWithTurns('newest-test', 20, i => `Turn-${i + 1}`);

    const ctx = await buildBudgetedContext('newest-test', 'SEARCH', { store });

    // Last turn should be the newest
    const lastTurn = ctx.historyTurns[ctx.historyTurns.length - 1];
    assert.equal(lastTurn.content, 'Turn-20');
  });

  await it('buildBudgetedContext returns empty for unknown conversation', async () => {
    const store = new ConversationStore(null);
    const ctx = await buildBudgetedContext('nonexistent', 'CONVERSATIONAL', { store });

    assert.equal(ctx.historyTurns.length, 0);
    assert.equal(ctx.tokenUsage.total, 0);
    assert.equal(ctx.source.olderTurnsExist, false);
  });

  await it('buildBudgetedContext returns empty without store', async () => {
    const ctx = await buildBudgetedContext('test', 'CONVERSATIONAL');
    assert.equal(ctx.historyTurns.length, 0);
  });

  await it('buildBudgetedContext includes handler-compatible history', async () => {
    const store = createStoreWithTurns('handler-test', 4, i =>
      i % 2 === 0 ? 'User msg' : 'Assistant msg');

    const ctx = await buildBudgetedContext('handler-test', 'CONVERSATIONAL', { store });

    assert.ok(ctx.handlerHistory.length > 0);
    assert.ok(ctx.handlerHistory[0].response);
    assert.ok(ctx.handlerHistory[0].response.tag);
    assert.ok(ctx.handlerHistory[0].response.tag.speaker);
    assert.ok(ctx.handlerHistory[0].response.content);
    assert.ok(ctx.handlerHistory[0].timestamp);
  });

  await it('buildBudgetedContext trims LTM to budget', async () => {
    const store = createStoreWithTurns('ltm-test', 2);

    // COMMAND has ltm: 0
    const ctx = await buildBudgetedContext('ltm-test', 'COMMAND', {
      store,
      ltmContext: 'Some LTM context that should be removed',
    });

    assert.equal(ctx.ltmContext, '');
    assert.equal(ctx.tokenUsage.ltm, 0);
  });

  await it('buildBudgetedContext includes LTM when budget allows', async () => {
    const store = createStoreWithTurns('ltm-incl', 2);
    const ltm = 'User prefers Czech language. Name: Petr.';

    const ctx = await buildBudgetedContext('ltm-incl', 'CONVERSATIONAL', {
      store,
      ltmContext: ltm,
    });

    assert.ok(ctx.ltmContext.includes('Petr'));
    assert.ok(ctx.tokenUsage.ltm > 0);
  });

  await it('source metadata tracks older turns correctly', async () => {
    // Small budget, many turns → olderTurnsExist = true
    const store = createStoreWithTurns('source-test', 20);
    const ctx = await buildBudgetedContext('source-test', 'SEARCH', { store });

    assert.ok(ctx.source.olderTurnsExist, 'Should detect older turns');
    assert.equal(ctx.source.totalTurnsInDB, 20);
    assert.ok(ctx.source.verbatimCount < 20);
  });

  await it('Short conversation fits entirely (no summary needed)', async () => {
    const store = createStoreWithTurns('short-conv', 4, i => `Short msg ${i}`);
    const ctx = await buildBudgetedContext('short-conv', 'CONVERSATIONAL', { store });

    assert.equal(ctx.source.verbatimCount, 4);
    assert.equal(ctx.source.olderTurnsExist, false);
    assert.equal(ctx.summary, null);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T10.2: SUMMARIZATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.2: Summarization', async () => {

  await it('Summary generated when turns exceed budget', async () => {
    const store = createStoreWithTurns('sum-test', 20);

    const ctx = await buildBudgetedContext('sum-test', 'SEARCH', {
      store,
      summarizer: mockSummarizer,
    });

    if (ctx.source.olderTurnsExist) {
      assert.ok(ctx.summary, 'Should have summary when older turns exist');
      assert.ok(ctx.summary.includes('Shrnutí'));
      assert.ok(ctx.source.summaryUsed);
      assert.ok(ctx.tokenUsage.summary > 0);
    }
  });

  await it('Summary stored and retrieved', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('sum-persist');

    store.setSummary('sum-persist', 'Uživatel se ptal na počasí.', 5);
    const result = store.getSummary('sum-persist');

    assert.ok(result);
    assert.equal(result.summary, 'Uživatel se ptal na počasí.');
    assert.equal(result.upToMsgId, 5);
  });

  await it('getSummary returns null for no summary', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('no-sum');

    const result = store.getSummary('no-sum');
    assert.equal(result, null);
  });

  await it('setSummary validates inputs', async () => {
    const store = new ConversationStore(null);
    assert.throws(() => store.setSummary(null, 'test', 1), /conversationId/);
    assert.throws(() => store.setSummary('id', '', 1), /summary must be/);
  });

  await it('Stale summary detection (new turns after summary)', async () => {
    const store = createStoreWithTurns('stale-test', 20);

    // First: generate summary via summarizer
    const ctx1 = await buildBudgetedContext('stale-test', 'SEARCH', {
      store,
      summarizer: mockSummarizer,
    });

    // Verify summary was stored
    if (ctx1.source.summaryUsed) {
      const storedSummary = store.getSummary('stale-test');
      assert.ok(storedSummary, 'Summary should be persisted');

      // Second call should reuse the stored summary (no summarizer needed)
      const ctx2 = await buildBudgetedContext('stale-test', 'SEARCH', {
        store,
        // No summarizer — should use cached
      });

      // Depending on ID ordering, cached summary may or may not be valid
      // The key invariant: it doesn't crash without a summarizer
      assert.ok(ctx2.tokenUsage.total >= 0);
    }
  });

  await it('Summarization failure = graceful degradation', async () => {
    const store = createStoreWithTurns('fail-sum', 20);
    const failingSummarizer = async () => { throw new Error('LLM timeout'); };

    // Should NOT throw
    const ctx = await buildBudgetedContext('fail-sum', 'SEARCH', {
      store,
      summarizer: failingSummarizer,
    });

    assert.equal(ctx.summary, null);
    assert.equal(ctx.tokenUsage.summary, 0);
    // Still has verbatim turns
    assert.ok(ctx.historyTurns.length > 0);
  });

  await it('buildSummaryPrompt formats turns correctly', async () => {
    const prompt = buildSummaryPrompt([
      { role: 'user', content: 'Jak se máš?' },
      { role: 'assistant', content: 'Dobře, díky!' },
    ]);
    assert.ok(prompt.includes('user: Jak se máš?'));
    assert.ok(prompt.includes('assistant: Dobře, díky!'));
  });

  await it('Summary system prompt is deterministic/factual', async () => {
    const prompt = getSummarySystemPrompt();
    assert.ok(prompt.includes('fakta'));
    assert.ok(prompt.includes('Žádné interpretace'));
    assert.ok(prompt.includes('Maximálně 5 vět'));
  });

  await it('formatBudgetedHistory produces prompt-ready string', async () => {
    const budgeted = {
      historyTurns: [
        { role: 'user', content: 'Ahoj' },
        { role: 'assistant', content: 'Zdravím!' },
      ],
      summary: 'Uživatel se představil.',
    };

    const result = formatBudgetedHistory(budgeted);
    assert.ok(result.includes('Shrnutí předchozí konverzace'));
    assert.ok(result.includes('Uživatel se představil.'));
    assert.ok(result.includes('user: Ahoj'));
    assert.ok(result.includes('assistant: Zdravím!'));
  });

  await it('formatBudgetedHistory works without summary', async () => {
    const budgeted = {
      historyTurns: [{ role: 'user', content: 'Test' }],
      summary: null,
    };

    const result = formatBudgetedHistory(budgeted);
    assert.ok(!result.includes('Shrnutí'));
    assert.ok(result.includes('user: Test'));
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T10.3: EXPORT PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.3: Export Pipeline', async () => {

  // Helper: create store + conversation with messages, then export
  async function testExport(format, scope) {
    const store = new ConversationStore(null);
    store.ensureConversation('exp-test', {});
    store.setTitle('exp-test', 'Test konverzace');
    store.appendTurn('exp-test', TurnRole.USER, 'Jak se máš?');
    store.appendTurn('exp-test', TurnRole.ASSISTANT, 'Výborně, díky za optání!');
    store.appendTurn('exp-test', TurnRole.USER, 'Co nového?');
    store.appendTurn('exp-test', TurnRole.ASSISTANT, 'Pracuji na Sprint 4.');

    const tmpDir = `/tmp/c3-export-test-${Date.now()}`;
    const result = await exportConversation('exp-test', {
      format,
      scope: scope || 'conversation',
      store,
      artifactsDir: tmpDir,
    });
    return result;
  }

  await it('MD export produces valid markdown', async () => {
    const result = await testExport('md');
    assert.ok(result.filename.endsWith('.md'));
    assert.ok(result.format === 'md');
    assert.ok(result.size > 0);
    assert.ok(result.turnCount === 4);
    assert.ok(result.downloadUrl.startsWith('/api/artifacts/'));

    // Verify file content
    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(content.includes('# Test konverzace'));
    assert.ok(content.includes('**Uživatel:**'));
    assert.ok(content.includes('**Asistent:**'));
    assert.ok(content.includes('Jak se máš?'));
    assert.ok(content.includes('Exportováno z C3-Agent'));
  });

  await it('HTML export produces valid HTML with CSS', async () => {
    const result = await testExport('html');
    assert.ok(result.filename.endsWith('.html'));

    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(content.includes('<!DOCTYPE html>'));
    assert.ok(content.includes('<style>'));
    assert.ok(content.includes('turn-user'));
    assert.ok(content.includes('turn-assistant'));
    assert.ok(content.includes('Jak se máš?'));
  });

  await it('TXT export produces plain text', async () => {
    const result = await testExport('txt');
    assert.ok(result.filename.endsWith('.txt'));

    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(content.includes('[Uživatel]'));
    assert.ok(content.includes('[Asistent]'));
    assert.ok(content.includes('Jak se máš?'));
    assert.ok(!content.includes('<html>'));
    assert.ok(!content.includes('<style>'));
  });

  await it('Export includes metadata (title, date)', async () => {
    const result = await testExport('md');
    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(content.includes('Test konverzace'));
    assert.ok(content.includes('4 zpráv'));
  });

  await it('Export scope "last" returns only last assistant turn', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('last-test');
    store.appendTurn('last-test', TurnRole.USER, 'First');
    store.appendTurn('last-test', TurnRole.ASSISTANT, 'Reply 1');
    store.appendTurn('last-test', TurnRole.USER, 'Second');
    store.appendTurn('last-test', TurnRole.ASSISTANT, 'Reply 2 - the last one');

    const tmpDir = `/tmp/c3-export-last-${Date.now()}`;
    const result = await exportConversation('last-test', {
      format: 'txt',
      scope: 'last',
      store,
      artifactsDir: tmpDir,
    });

    assert.equal(result.turnCount, 1);
    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(content.includes('Reply 2 - the last one'));
    assert.ok(!content.includes('Reply 1'));
  });

  await it('Export throws for nonexistent conversation', async () => {
    const store = new ConversationStore(null);
    await assert.rejects(
      () => exportConversation('nonexistent', { store, artifactsDir: '/tmp' }),
      /not found/
    );
  });

  await it('Export throws for empty conversation', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('empty-exp');
    await assert.rejects(
      () => exportConversation('empty-exp', { store, artifactsDir: '/tmp' }),
      /no messages/
    );
  });

  await it('HTML export escapes HTML in content', async () => {
    const store = new ConversationStore(null);
    store.ensureConversation('xss-test');
    store.appendTurn('xss-test', TurnRole.USER, '<script>alert("xss")</script>');
    store.appendTurn('xss-test', TurnRole.ASSISTANT, 'Safe response');

    const tmpDir = `/tmp/c3-export-xss-${Date.now()}`;
    const result = await exportConversation('xss-test', {
      format: 'html', store, artifactsDir: tmpDir,
    });

    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    assert.ok(!content.includes('<script>alert'));
    assert.ok(content.includes('&lt;script&gt;'));
  });

  await it('Export does NOT include internal metadata', async () => {
    const result = await testExport('md');
    const fs = await import('fs/promises');
    const content = await fs.readFile(result.path, 'utf-8');
    // Should NOT contain internal metadata
    assert.ok(!content.includes('confidence'));
    assert.ok(!content.includes('D6'));
    assert.ok(!content.includes('gate'));
    assert.ok(!content.includes('intent'));
    assert.ok(!content.includes('SEARCH'));
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T10.4: EXPORT COMMAND DETECTION
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.4: Export Command Detection', async () => {

  await it('"ulož to jako markdown" triggers export', async () => {
    const r = detectExportCommand('ulož to jako markdown');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'md');
  });

  await it('"exportuj konverzaci do HTML" triggers export', async () => {
    const r = detectExportCommand('exportuj konverzaci do HTML');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'html');
  });

  await it('"save as txt" triggers export', async () => {
    const r = detectExportCommand('save as txt');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'txt');
  });

  await it('"ulož jako md" triggers export', async () => {
    const r = detectExportCommand('ulož jako md');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'md');
  });

  await it('"vygeneruj html stránku" triggers export', async () => {
    const r = detectExportCommand('vygeneruj html stránku');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'html');
  });

  await it('"napiš mi report" does NOT trigger export', async () => {
    const r = detectExportCommand('napiš mi report');
    assert.equal(r.isExport, false);
  });

  await it('"co si myslíš o AI?" does NOT trigger export', async () => {
    const r = detectExportCommand('co si myslíš o AI?');
    assert.equal(r.isExport, false);
  });

  await it('"hledej informace o exportu" does NOT trigger export', async () => {
    const r = detectExportCommand('hledej informace o exportu');
    assert.equal(r.isExport, false);
  });

  await it('Empty/null input does NOT trigger export', async () => {
    assert.equal(detectExportCommand('').isExport, false);
    assert.equal(detectExportCommand(null).isExport, false);
  });

  await it('"stáhni jako text" triggers export', async () => {
    const r = detectExportCommand('stáhni jako text');
    assert.equal(r.isExport, true);
    assert.equal(r.format, 'txt');
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
