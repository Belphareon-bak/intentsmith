// tests/e2e/51-cre-classification.e2e.js — CRE intent classification via chat
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires Ollama. FACTUAL, SEARCH, and REPORT cases also require
// external network access and assert successful data-backed tool execution.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  waitForServer,
  createConv,
  chatWithTimeout,
  cleanupConversation,
  LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];

async function assertIntent({
  title,
  message,
  expectedIntent,
  requiresToolSuccess = false,
  requiresPipelineSearch = false,
  timeout = LLM_TIMEOUT * 3,
}) {
  await testAsync(title, async () => {
    const convId = await createConv(`cre-${expectedIntent.toLowerCase()}`);
    created.push(convId);
    const result = await chatWithTimeout(convId, message, timeout - 5_000);

    assertEqual(result.status, 200);
    assertEqual(
      result.intent,
      expectedIntent,
      `"${message}" must resolve to the supported ${expectedIntent} intent`,
    );

    if (requiresToolSuccess) {
      assertEqual(
        result.metadata?.executionStatus,
        'SUCCESS',
        `${expectedIntent} must not pass through an LLM-only search fallback`,
      );
      const toolResults = result.metadata?.toolResults;
      assert(Array.isArray(toolResults) && toolResults.length > 0, 'tool results are required');
      assert(
        toolResults.some(tool => tool.success === true),
        `${expectedIntent} requires at least one successful external tool result`,
      );
    }

    if (requiresPipelineSearch) {
      assertEqual(result.metadata?.pipeline, expectedIntent);
      assert(
        Number.isInteger(result.metadata?.searchResults)
          && result.metadata.searchResults > 0,
        `${expectedIntent} requires at least one external search result`,
      );
    }
  }, timeout);
}

try {
  suite('CRE — Answer Intents');

  await assertIntent({
    title: 'greeting is CONVERSATIONAL',
    message: 'Ahoj, jak se máš?',
    expectedIntent: 'CONVERSATIONAL',
  });

  await assertIntent({
    title: 'creative writing request is CREATIVE',
    message: 'Napiš mi básničku o kočce.',
    expectedIntent: 'CREATIVE',
  });

  await assertIntent({
    title: 'code generation request is CODE',
    message: 'Napiš funkci v Pythonu, která počítá faktoriál.',
    expectedIntent: 'CODE',
  });

  await assertIntent({
    title: 'explicit code review request is CODE_ANALYSIS',
    message: 'Proveď code review tohoto kódu: function add(a,b) { return a+b; }',
    expectedIntent: 'CODE_ANALYSIS',
  });

  suite('CRE — External Tool Intents');

  await assertIntent({
    title: 'exchange-rate request is FACTUAL with successful external data',
    message: 'Kurz EUR CZK',
    expectedIntent: 'FACTUAL',
    requiresToolSuccess: true,
  });

  await assertIntent({
    title: 'explicit web lookup is SEARCH with successful external data',
    message: 'Vyhledej aktuální oficiální informace o Node.js 22.',
    expectedIntent: 'SEARCH',
    requiresToolSuccess: true,
  });

  await assertIntent({
    title: 'fresh comparison request is REPORT with search-backed synthesis',
    message: 'Porovnej aktuální stabilní verze Reactu a Vue.js.',
    expectedIntent: 'REPORT',
    requiresPipelineSearch: true,
    timeout: LLM_TIMEOUT * 5,
  });

  suite('CRE — Deterministic and Short Inputs');

  await assertIntent({
    title: 'local arithmetic is LOCAL',
    message: 'Kolik je 847 * 23?',
    expectedIntent: 'LOCAL',
  });

  await assertIntent({
    title: 'very short first input follows the optimistic CONVERSATIONAL contract',
    message: 'ok',
    expectedIntent: 'CONVERSATIONAL',
  });

  await assertIntent({
    title: 'emoji-only first input follows the optimistic CONVERSATIONAL contract',
    message: '👍',
    expectedIntent: 'CONVERSATIONAL',
  });
} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
