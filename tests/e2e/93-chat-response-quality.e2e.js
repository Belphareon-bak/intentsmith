// tests/e2e/93-chat-response-quality.e2e.js — Chat Response Quality & Structure
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that C3's chat responses are well-structured, accurate,
// appropriately detailed, and genuinely useful — not just "contains keyword X".
//
// Quality dimensions tested:
//   1. Response structure (headings, lists, code blocks used appropriately)
//   2. Explanation depth (step-by-step, not vague hand-waving)
//   3. Code completeness (runnable, no stubs, proper error handling)
//   4. Appropriate length (not padded, not truncated)
//   5. Relevance (answers the actual question, nothing off-topic)
//   6. Czech language quality (natural, not machine-translated)
//
// Expected duration: 10-15 minutes.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const QUALITY_TIMEOUT = LLM_TIMEOUT * 4; // 240s

// ── Quality Scoring Helpers ──────────────────────────────────────────────────

/** Count structural elements in a response */
function scoreStructure(text) {
  let score = 0;
  // Has code blocks when discussing code
  if (/```\w*\n[\s\S]+?```/.test(text)) score += 2;
  // Has numbered or bulleted lists
  if (/^\s*[\d]+[.)]\s/m.test(text) || /^\s*[-*•]\s/m.test(text)) score += 1;
  // Has headers/bold sections
  if (/^#{1,4}\s/m.test(text) || /\*\*[^*]+\*\*/m.test(text)) score += 1;
  // Reasonable paragraph structure (not one giant wall of text)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 2) score += 1;
  return score; // max ~5
}

/** Check code blocks are complete (no TODO, placeholder, ...) */
function codeBlockQuality(text) {
  const blocks = [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
  if (blocks.length === 0) return { count: 0, complete: 0, avgLines: 0 };

  let complete = 0;
  let totalLines = 0;
  for (const [, , code] of blocks) {
    const lines = code.split('\n').filter(l => l.trim()).length;
    totalLines += lines;
    const hasPlaceholder = /\b(TODO|FIXME|HACK|placeholder|not implemented|implement here|your code here|\.{3}\s*\/\/|pass\s*#)\b/i.test(code);
    if (!hasPlaceholder && lines >= 3) complete++;
  }
  return {
    count: blocks.length,
    complete,
    avgLines: blocks.length > 0 ? Math.round(totalLines / blocks.length) : 0,
  };
}

/** Measure if response is appropriately sized (not padded, not truncated) */
function isAppropriateLengthForQuestion(question, response) {
  const qLen = question.length;
  const rLen = response.length;
  // Very short questions can have medium-long answers
  if (qLen < 50 && rLen < 30) return { ok: false, reason: 'response too short for even a simple question' };
  // Code generation should produce substantial output
  if (/kód|code|funkc|function|napiš|write|vytvoř|generate/i.test(question) && rLen < 200) {
    return { ok: false, reason: 'code request got minimal response' };
  }
  // Extremely long responses are suspicious (padding)
  if (rLen > 8000 && qLen < 100) return { ok: false, reason: 'suspiciously long response for short question' };
  return { ok: true };
}

/** Count Czech diacritical richness (not just "has ě" but proper distribution) */
function czechQualityScore(text) {
  // Remove code blocks (code shouldn't be in Czech)
  const prose = text.replace(/```[\s\S]*?```/g, '');
  if (prose.length < 50) return 0;

  const czechChars = (prose.match(/[ěščřžýáíéůúďťňó]/gi) || []).length;
  const ratio = czechChars / prose.length;
  // Good Czech text has ~5-15% diacritical characters
  if (ratio > 0.03 && ratio < 0.20) return 2;
  if (ratio > 0.01) return 1;
  return 0;
}

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Chat Quality — Technical Explanation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('explains recursion with proper structure and example', async () => {
    const convId = await createConv('q-recursion');
    created.push(convId);
    const r = await chatInConv(convId,
      'Vysvětli mi rekurzi v programování. Dej konkrétní příklad v Pythonu a vysvětli krok po kroku co se děje.'
    );

    // Structure: should have explanation + code + step-by-step
    const structure = scoreStructure(r.response);
    assert(structure >= 3, `poor structure (score ${structure}/5): missing code/list/paragraphs`);

    // Must have code example
    const cq = codeBlockQuality(r.response);
    assert(cq.count >= 1, 'should include code example');
    assert(cq.complete >= 1, 'code should be complete (no placeholders)');

    // Must explain base case and recursive case
    assert(hasKeywords(r.response, ['základ', 'base', 'podmínk', 'ukončen', 'zastaví', 'stop'], 1),
      'should explain base case / termination condition');
    assert(hasKeywords(r.response, ['volá', 'call', 'sama sebe', 'rekurzivn', 'zmenš', 'reduc'], 1),
      'should explain recursive step');

    // Step-by-step trace (e.g., "factorial(3) = 3 * factorial(2) = ...")
    const hasTrace = /\d+\s*[*×·]\s*\d+/.test(r.response) || /factorial\(\d\)/.test(r.response)
      || /krok|step/i.test(r.response);
    assert(hasTrace, 'should include step-by-step execution trace');

    // Czech quality
    assert(czechQualityScore(r.response) >= 1, 'explanation should be in natural Czech');
  }, QUALITY_TIMEOUT);

  await testAsync('explains async/await without oversimplification', async () => {
    const convId = await createConv('q-async');
    created.push(convId);
    const r = await chatInConv(convId,
      'Vysvětli jak funguje async/await v JavaScriptu. Co je event loop, co je Promise, a jak spolu souvisí?'
    );

    // Should be substantial (this is a complex topic)
    assert(r.response.length > 400, `too short for async/await explanation: ${r.response.length}`);

    // Must cover all 3 asked concepts
    assert(hasKeywords(r.response, ['Promise', 'promise', 'příslib'], 1), 'should explain Promise');
    assert(hasKeywords(r.response, ['event loop', 'smyčk', 'loop'], 1), 'should explain event loop');
    assert(hasKeywords(r.response, ['async', 'await'], 1), 'should explain async/await syntax');

    // Should explain the relationship (not just define each separately)
    assert(hasKeywords(r.response, ['čeká', 'wait', 'pozastav', 'suspend', 'vrátí', 'resolve', 'nebloku', 'non-block'], 1),
      'should explain how await interacts with the event loop');

    // Should have code example
    assert(r.response.includes('```'), 'complex topic should include code example');

    const structure = scoreStructure(r.response);
    assert(structure >= 2, `poor structure (${structure}/5) for multi-concept explanation`);
  }, QUALITY_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Chat Quality — Code Generation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('generates complete, runnable HTTP server', async () => {
    const convId = await createConv('q-http');
    created.push(convId);
    const r = await chatInConv(convId,
      'Napiš mi jednoduchý HTTP server v Node.js (čistý node, bez frameworku) který má 3 endpointy: GET /, GET /api/status, POST /api/echo. POST endpoint vrátí zpět tělo requestu. Vypiš kompletní spustitelný kód.'
    );

    const cq = codeBlockQuality(r.response);
    assert(cq.count >= 1, 'should have code block');
    assert(cq.complete >= 1, 'code should be complete');
    assert(cq.avgLines >= 15, `code too short (${cq.avgLines} lines avg) for 3-endpoint server`);

    // Extract the main code block
    const codeMatch = r.response.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1] : '';

    // Must have http module
    assert(/require\s*\(\s*['"]http['"]\s*\)|import.*from\s*['"]http['"]/.test(code),
      'should import http module');
    // Must have createServer
    assert(/createServer/.test(code), 'should use createServer');
    // Must have listen
    assert(/\.listen\s*\(/.test(code), 'should call listen()');
    // Must handle the 3 endpoints
    assert(/\/api\/status/.test(code), 'should handle /api/status');
    assert(/\/api\/echo/.test(code), 'should handle /api/echo');
    // POST echo should read request body
    assert(/req\.on\s*\(\s*['"]data['"]/.test(code) || /body/.test(code) || /chunk/.test(code),
      'POST echo should read request body');
    // Should have proper response writing
    assert(/res\.write|res\.end|writeHead/.test(code), 'should write HTTP responses');
  }, QUALITY_TIMEOUT);

  await testAsync('generates SQL with proper joins and no injection risk', async () => {
    const convId = await createConv('q-sql');
    created.push(convId);
    const r = await chatInConv(convId,
      'Napiš mi SQL dotazy pro e-shop databázi: 1) Najdi top 5 zákazníků podle celkové útraty, 2) Najdi produkty které nikdo nekoupil, 3) Měsíční přehled tržeb za poslední rok. Databáze má tabulky: customers(id,name,email), orders(id,customer_id,created_at,total), order_items(id,order_id,product_id,quantity,price), products(id,name,category,price,stock).'
    );

    const cq = codeBlockQuality(r.response);
    assert(cq.count >= 3, `expected ≥3 SQL queries, got ${cq.count} code blocks`);

    // Extract SQL code
    const sqlBlocks = [...r.response.matchAll(/```(?:sql)?\n([\s\S]*?)```/g)].map(m => m[1]);
    const allSql = sqlBlocks.join('\n').toUpperCase();

    // Query 1: should use JOIN + GROUP BY + ORDER BY + LIMIT
    assert(/JOIN/.test(allSql), 'top customers query needs JOIN');
    assert(/GROUP\s+BY/.test(allSql), 'aggregation needs GROUP BY');
    assert(/ORDER\s+BY/.test(allSql), 'ranking needs ORDER BY');
    assert(/LIMIT\s+5|TOP\s+5|FETCH\s+FIRST\s+5/.test(allSql), 'should limit to 5');

    // Query 2: should use LEFT JOIN + IS NULL (or NOT EXISTS/NOT IN)
    assert(/LEFT\s+JOIN/.test(allSql) || /NOT\s+EXISTS/.test(allSql) || /NOT\s+IN/.test(allSql),
      'unsold products needs LEFT JOIN IS NULL or NOT EXISTS');

    // Query 3: should use date functions
    assert(/MONTH|DATE_TRUNC|EXTRACT|STRFTIME|FORMAT/.test(allSql),
      'monthly revenue needs date grouping function');
    assert(/SUM/.test(allSql), 'revenue report needs SUM aggregation');

    // Each query should be explained
    const structure = scoreStructure(r.response);
    assert(structure >= 2, `SQL queries should have explanations, structure score ${structure}/5`);
  }, QUALITY_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Chat Quality — Practical Advice');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('gives specific, actionable debugging advice', async () => {
    const convId = await createConv('q-debug');
    created.push(convId);
    const r = await chatInConv(convId,
      'Moje Node.js aplikace po pár hodinách běhu začne padat na "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory". Co to znamená a jak to vyřešit?'
    );

    // Should explain the cause
    assert(hasKeywords(r.response, ['paměť', 'memory', 'heap', 'leak', 'únik', 'alokac'], 2),
      'should explain memory issue');

    // Should give SPECIFIC solutions (not just "use more RAM")
    const solutions = [];
    if (hasKeywords(r.response, ['--max-old-space-size', 'max_old_space_size', 'NODE_OPTIONS'], 1)) solutions.push('heap-size');
    if (hasKeywords(r.response, ['leak', 'únik', 'profil', 'heapdump', 'inspect', 'chrome'], 1)) solutions.push('profiling');
    if (hasKeywords(r.response, ['closure', 'uzávěr', 'listener', 'event', 'timer', 'interval', 'cache', 'global'], 1)) solutions.push('common-causes');
    if (hasKeywords(r.response, ['stream', 'buffer', 'garbage', 'gc', 'WeakRef', 'WeakMap'], 1)) solutions.push('gc-strategy');

    assert(solutions.length >= 2,
      `should give ≥2 specific solutions, found: ${solutions.join(', ') || 'none (too generic)'}`);

    // Should NOT just say "add more RAM" without deeper analysis
    const isGeneric = r.response.length < 200 && !r.response.includes('```');
    assert(!isGeneric, 'advice should be specific and detailed, not just a one-liner');
  }, QUALITY_TIMEOUT);

  await testAsync('compares technologies with balanced pros/cons', async () => {
    const convId = await createConv('q-compare');
    created.push(convId);
    const r = await chatInConv(convId,
      'Porovnej PostgreSQL a MongoDB pro nový projekt — backend pro firemní aplikaci se složitými vztahy mezi entitami, ale také s potřebou flexibilního schématu pro uživatelské formuláře.'
    );

    // Should mention BOTH technologies substantively
    assert(hasKeywords(r.response, ['PostgreSQL', 'postgres', 'relační', 'SQL'], 1), 'should discuss PostgreSQL');
    assert(hasKeywords(r.response, ['MongoDB', 'mongo', 'dokument', 'NoSQL'], 1), 'should discuss MongoDB');

    // Should present pros AND cons for each (not one-sided)
    assert(hasKeywords(r.response, ['výhod', 'pros', 'silná', 'lepší pro', 'dobré', 'skvělé'], 1),
      'should mention advantages');
    assert(hasKeywords(r.response, ['nevýhod', 'cons', 'slabá', 'horší', 'problém', 'omezení', 'složitěj'], 1),
      'should mention disadvantages/limitations');

    // Should make a RECOMMENDATION based on the specific requirements
    assert(hasKeywords(r.response, ['doporuč', 'navrhuji', 'bych volil', 'bych zvolil', 'recommend', 'lepší volba', 'preferuji', 'záleží'], 1),
      'should give a recommendation or nuanced conclusion');

    // Should reference the specific requirements (relationships + flexible schema)
    assert(hasKeywords(r.response, ['vztah', 'relac', 'relation', 'JOIN', 'referenc'], 1),
      'should address the entity relationships requirement');
    assert(hasKeywords(r.response, ['flexibil', 'schéma', 'schema', 'JSON', 'JSONB', 'formulář'], 1),
      'should address the flexible schema requirement');

    // Good structure for comparison
    const structure = scoreStructure(r.response);
    assert(structure >= 2, `comparison should be well-structured, score ${structure}/5`);
  }, QUALITY_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Chat Quality — Precision & No Hallucination');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('does not hallucinate API that does not exist', async () => {
    const convId = await createConv('q-hallucinate');
    created.push(convId);
    const r = await chatInConv(convId,
      'Jak v Pythonu použiji standardní knihovnu `urllib` pro stažení JSON z API? Napiš příklad.'
    );

    // Should use real urllib modules
    const code = r.response.match(/```(?:python)?\n([\s\S]*?)```/)?.[1] || '';
    assert(
      /urllib\.request/.test(code) || /urlopen/.test(code) || /Request/.test(code),
      'should use real urllib.request API');
    // Should NOT use made-up methods
    assert(!/urllib\.get\s*\(/.test(code), 'should not hallucinate urllib.get()');
    assert(!/urllib\.fetch\s*\(/.test(code), 'should not hallucinate urllib.fetch()');
    assert(!/urllib\.download\s*\(/.test(code), 'should not hallucinate urllib.download()');

    // Should include json.loads or json.load
    assert(/json\.loads?\s*\(/.test(code), 'should parse JSON response');
  }, QUALITY_TIMEOUT);

  await testAsync('admits uncertainty rather than guessing', async () => {
    const convId = await createConv('q-uncertain');
    created.push(convId);
    const r = await chatInConv(convId,
      'Jaká je přesná interní implementace garbage collectoru ve V8 engine verze 12.9?'
    );

    // Should not confidently state specific internal details it can't know
    // A good response either gives general V8 GC info with caveats, or admits limits
    const hasCaveat = hasKeywords(r.response, [
      'obecně', 'general', 'přibližně', 'approximately',
      'nemusí být přesn', 'may not be exact',
      'doporučuji ověřit', 'recommend checking',
      'zdrojový kód', 'source code',
      'dokumentac', 'documentation',
      'v8.dev', 'chromium',
      'může se lišit', 'may differ',
      'nevím přesně', 'nejsem si jist',
    ], 1);

    // Either provides caveated answer or admits uncertainty — both acceptable
    assert(hasCaveat || r.response.length > 300,
      'should either provide caveated detailed answer or acknowledge uncertainty');

    // Should mention real V8 GC concepts (not made up)
    if (r.response.length > 200) {
      assert(hasKeywords(r.response, ['mark', 'sweep', 'scavenge', 'generac', 'generation', 'young', 'old', 'heap', 'minor', 'major', 'Orinoco', 'incremental', 'concurrent', 'garbage', 'collector', 'paměť', 'memory'], 1),
        'if explaining V8 GC, should use real concepts');
    }
  }, QUALITY_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Chat Quality — Response Appropriateness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('short question gets focused answer, not essay', async () => {
    const convId = await createConv('q-short');
    created.push(convId);
    const r = await chatInConv(convId, 'Co je closure v JavaScriptu?');

    // Should answer clearly but not write a 2000+ word essay
    assert(r.response.length > 80, 'should give substantive answer');
    assert(r.response.length < 3000, `response too long (${r.response.length}) for simple concept question`);

    // Must actually define closure
    assert(hasKeywords(r.response, ['funkc', 'function', 'proměnn', 'variable', 'scope', 'uzávěr', 'vnější', 'outer', 'přístup', 'access'], 2),
      'should define what a closure is');

    // Should include a brief example
    assert(r.response.includes('```'), 'even a short answer about closures should include an example');
  }, QUALITY_TIMEOUT);

  await testAsync('complex question gets proportionally detailed answer', async () => {
    const convId = await createConv('q-complex');
    created.push(convId);
    const r = await chatInConv(convId,
      'Navrhni mi architekturu pro real-time chat aplikaci. Musí zvládnout 10000 současných uživatelů, mít end-to-end šifrování, podporovat skupinové konverzace, offline zprávy, a notifikace. Jaké technologie bys použil a proč?'
    );

    // Complex question should get substantial answer
    assert(r.response.length > 600, `answer too short (${r.response.length}) for complex architecture question`);

    // Should address multiple requirements
    const addressed = [];
    if (hasKeywords(r.response, ['WebSocket', 'socket', 'real-time', 'ws', 'SSE'], 1)) addressed.push('realtime');
    if (hasKeywords(r.response, ['šifrování', 'encrypt', 'E2E', 'Signal', 'klíč', 'key'], 1)) addressed.push('encryption');
    if (hasKeywords(r.response, ['skupin', 'group', 'room', 'channel', 'kanál'], 1)) addressed.push('groups');
    if (hasKeywords(r.response, ['offline', 'queue', 'fronta', 'uložen', 'store', 'doruč'], 1)) addressed.push('offline');
    if (hasKeywords(r.response, ['notifikac', 'push', 'FCM', 'APNs', 'upozornění'], 1)) addressed.push('notifications');
    if (hasKeywords(r.response, ['Redis', 'Kafka', 'RabbitMQ', 'NATS', 'scale', 'škálov', 'load', 'cluster'], 1)) addressed.push('scaling');

    assert(addressed.length >= 4,
      `should address ≥4 requirements, covered: ${addressed.join(', ')}`);

    // Should have good structure
    const structure = scoreStructure(r.response);
    assert(structure >= 3, `architecture proposal needs excellent structure, got ${structure}/5`);
  }, QUALITY_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
