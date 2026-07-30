// tests/e2e/94-long-conversation-quality.e2e.js — Long Conversation Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that C3 maintains quality across 10+ turn conversations.
//
// Quality dimensions tested:
//   1. Context retention — references to earlier turns remain accurate
//   2. No degradation — response quality doesn't drop after many turns
//   3. Coherence — advice stays consistent, no contradictions
//   4. Topic switching — can handle topic changes without confusion
//   5. Cumulative understanding — builds on prior context, not isolated answers
//   6. No metadata leak — JSON internals never appear in responses
//   7. Language stability — Czech maintained throughout
//
// Expected duration: 15-25 minutes (12+ LLM calls).
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const TURN_TIMEOUT = LLM_TIMEOUT * 4; // 240s per turn

// ── Quality Scoring Helpers ──────────────────────────────────────────────────

function scoreStructure(text) {
  let score = 0;
  if (/```\w*\n[\s\S]+?```/.test(text)) score += 2;
  if (/^\s*[\d]+[.)]\s/m.test(text) || /^\s*[-*•]\s/m.test(text)) score += 1;
  if (/^#{1,4}\s/m.test(text) || /\*\*[^*]+\*\*/m.test(text)) score += 1;
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 2) score += 1;
  return score;
}

function czechRatio(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '');
  if (prose.length < 30) return 0;
  const czechChars = (prose.match(/[ěščřžýáíéůúďťňó]/gi) || []).length;
  return czechChars / prose.length;
}

function hasMetadataLeak(text) {
  return /"decision_type"/.test(text) || /"intent_type"/.test(text)
    || /"confidence":\s*0\.\d/.test(text) || /"mode":\s*"/.test(text)
    || /CRE_DECISION/.test(text) || /GUARD_\d/.test(text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

let convId;
const responses = [];

try {
  suite('Long Conversation Quality — Progressive Building');

  // Turn 1: Establish a topic (REST API design)
  await testAsync('T1: establishes topic clearly', async () => {
    convId = await createConv('lq-long');
    created.push(convId);

    const r = await chatInConv(convId,
      'Chci navrhnout REST API pro knihovnu. Jaké endpointy bych měl mít pro správu knih? Poraď mi s návrhem.'
    );
    responses.push(r.response);
    assert(r.response.length > 200, `T1 too short: ${r.response.length}`);
    assert(hasKeywords(r.response, ['GET', 'POST', 'PUT', 'DELETE', 'endpoint', 'knih', 'book'], 3),
      'T1 should propose REST endpoints for books');
  }, TURN_TIMEOUT);

  // Turn 2: Drill into specifics
  await testAsync('T2: provides database schema for discussed API', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Dobře, a jaké databázové schéma by k tomu API mělo patřit? Jaké tabulky a sloupce?'
    );
    responses.push(r.response);

    // Should reference the book API from T1
    assert(hasKeywords(r.response, ['knih', 'book', 'titul', 'title', 'autor', 'author', 'ISBN', 'isbn'], 2),
      'T2 should relate DB schema to the book API from T1');
    // Should have actual column definitions
    assert(hasKeywords(r.response, ['id', 'INTEGER', 'VARCHAR', 'TEXT', 'PRIMARY', 'sloupec', 'column', 'tabulk', 'table'], 2),
      'T2 should define database columns');
  }, TURN_TIMEOUT);

  // Turn 3: Add complexity
  await testAsync('T3: adds authentication to existing API', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Jak bych měl přidat autentizaci k tomu API? Chci JWT tokeny. Které endpointy by měly být chráněné?'
    );
    responses.push(r.response);

    // Must reference the specific endpoints from T1
    assert(hasKeywords(r.response, ['JWT', 'jwt', 'token', 'autentiz', 'authenticat'], 1),
      'T3 should discuss JWT');
    assert(hasKeywords(r.response, ['POST', 'PUT', 'DELETE', 'chráněn', 'protect', 'middleware'], 2),
      'T3 should specify which endpoints to protect');
  }, TURN_TIMEOUT);

  // Turn 4: Ask about earlier context (cross-reference test)
  await testAsync('T4: accurately references earlier discussion', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Vrátím se k databázi — potřebuji přidat tabulku pro výpůjčky knih. Jak ji propojit s tou tabulkou knih co jsme navrhli?'
    );
    responses.push(r.response);

    // Should remember the books table from T2 and build on it
    assert(hasKeywords(r.response, ['výpůjčk', 'borrow', 'půjč', 'loan'], 1),
      'T4 should discuss borrowing/loans');
    assert(hasKeywords(r.response, ['FOREIGN KEY', 'foreign key', 'referenc', 'cizí klíč', 'book_id', 'knih'], 1),
      'T4 should reference the books table from T2');
  }, TURN_TIMEOUT);

  // Turn 5: Topic switch
  await testAsync('T5: handles topic switch without confusion', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Jiné téma — jak bys doporučil strukturovat frontend pro tu aplikaci? React nebo Vue? Jaké komponenty?'
    );
    responses.push(r.response);

    assert(hasKeywords(r.response, ['React', 'Vue', 'frontend', 'komponent', 'component'], 2),
      'T5 should discuss frontend frameworks');
    // Should still relate to the library app, not some random app
    assert(hasKeywords(r.response, ['knihovn', 'library', 'knih', 'book', 'výpůjčk', 'API', 'endpoint'], 1),
      'T5 should relate frontend to our library project');
  }, TURN_TIMEOUT);

  // Turn 6: Deep technical question
  await testAsync('T6: provides detailed error handling strategy', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Jakou strategii error handlingu bys doporučil pro to REST API? Jak řešit validační chyby, 404, 500, a rate limiting?'
    );
    responses.push(r.response);

    assert(r.response.length > 300, `T6 too short for error handling strategy: ${r.response.length}`);
    // Should mention specific HTTP codes
    assert(hasKeywords(r.response, ['400', '404', '500', '429', 'status', 'kód', 'code'], 2),
      'T6 should mention specific HTTP status codes');
    // Should be structured
    assert(scoreStructure(r.response) >= 2,
      'T6 error handling strategy should be well-structured');
  }, TURN_TIMEOUT);

  // Turn 7: Code implementation
  await testAsync('T7: generates code consistent with discussed design', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Ukaž mi příklad implementace GET /books a POST /books endpointu v Express.js, včetně toho error handlingu co jsme probírali a JWT autentizace na POST.'
    );
    responses.push(r.response);

    assert(r.response.includes('```'), 'T7 should include code');

    const code = r.response.match(/```(?:javascript|js)?\n([\s\S]*?)```/)?.[1] || '';
    // Should implement the endpoints we designed
    assert(/\/books/.test(code), 'T7 code should have /books route');
    // Should have JWT from T3
    assert(hasKeywords(r.response, ['jwt', 'token', 'verify', 'authoiz', 'bearer', 'middleware'], 1),
      'T7 code should include JWT auth from T3 discussion');
    // Should have error handling from T6
    assert(hasKeywords(r.response, ['catch', 'error', 'status', '404', '400', '500', 'try'], 2),
      'T7 code should have error handling from T6 discussion');
  }, TURN_TIMEOUT);

  // Turn 8: Testing
  await testAsync('T8: suggests tests for the code', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Jaké testy bych měl napsat pro ty endpointy? Napiš mi 3-4 příklady testovacích případů.'
    );
    responses.push(r.response);

    assert(hasKeywords(r.response, ['test', 'assert', 'expect', 'should', 'měl', 'ověř'], 2),
      'T8 should describe test cases');
    // Should reference the specific endpoints
    assert(hasKeywords(r.response, ['GET', 'POST', 'books', 'knih', '200', '201', '401', '404'], 2),
      'T8 tests should reference our specific endpoints');
  }, TURN_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Conversation Quality — Cross-Turn Consistency');
  // ═══════════════════════════════════════════════════════════════════════════

  // Turn 9: Summarize (tests comprehensive recall)
  await testAsync('T9: accurately summarizes full conversation', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Shrň mi celou tu architekturu co jsme navrhli — endpointy, databázi, autentizaci, error handling, frontend, testy. Co jsme pokryli a co nám chybí?'
    );
    responses.push(r.response);

    assert(r.response.length > 400, `T9 summary too short: ${r.response.length}`);

    // Should mention components from each major turn
    const recalled = [];
    if (hasKeywords(r.response, ['endpoint', 'REST', 'API', 'GET', 'POST'], 1)) recalled.push('endpoints');
    if (hasKeywords(r.response, ['databáz', 'database', 'tabulk', 'table', 'schéma'], 1)) recalled.push('database');
    if (hasKeywords(r.response, ['JWT', 'autentiz', 'token', 'authenticat'], 1)) recalled.push('auth');
    if (hasKeywords(r.response, ['error', 'chyb', '404', '500'], 1)) recalled.push('errors');
    if (hasKeywords(r.response, ['frontend', 'React', 'Vue', 'komponent'], 1)) recalled.push('frontend');
    if (hasKeywords(r.response, ['test', 'testov'], 1)) recalled.push('testing');
    if (hasKeywords(r.response, ['výpůjčk', 'půjč', 'loan', 'borrow'], 1)) recalled.push('borrowing');

    assert(recalled.length >= 4,
      `T9 should recall ≥4 topics, remembered: ${recalled.join(', ')}`);
  }, TURN_TIMEOUT);

  // Turn 10: Contradiction test
  await testAsync('T10: catches contradiction with earlier advice', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Vlastně, nebylo by lepší nepoužívat JWT a místo toho použít session cookies? Jaké by byly výhody a nevýhody oproti tomu co jsme navrhli?'
    );
    responses.push(r.response);

    // Should acknowledge the previous JWT recommendation and compare
    assert(hasKeywords(r.response, ['JWT', 'session', 'cookie', 'token'], 2),
      'T10 should compare sessions vs JWT from earlier');
    // Should provide balanced comparison, not just switch position
    assert(hasKeywords(r.response, ['výhod', 'nevýhod', 'pros', 'cons', 'oproti', 'versus', 'narozd', 'compar'], 1),
      'T10 should give balanced comparison, not just agree');
  }, TURN_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Conversation Quality — No Degradation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('response quality does not degrade across turns', async () => {
    // Compare early responses (T1-T3) vs late responses (T7-T10) on structure
    const early = responses.slice(0, 3);
    const late = responses.slice(-4);

    let earlyAvgLen = 0, lateAvgLen = 0;
    for (const r of early) earlyAvgLen += r.length;
    for (const r of late) lateAvgLen += r.length;
    earlyAvgLen = Math.round(earlyAvgLen / Math.max(early.length, 1));
    lateAvgLen = Math.round(lateAvgLen / Math.max(late.length, 1));

    // Late responses should be at least 50% as long as early (allowing some natural shortening)
    assert(lateAvgLen > earlyAvgLen * 0.5,
      `response length degraded: early avg ${earlyAvgLen}, late avg ${lateAvgLen}`);

    // Late structure should still be reasonable
    let lateStructureSum = 0;
    for (const r of late) lateStructureSum += scoreStructure(r);
    const lateAvgStructure = lateStructureSum / Math.max(late.length, 1);
    assert(lateAvgStructure >= 1.5,
      `late response structure degraded: avg score ${lateAvgStructure.toFixed(1)}/5`);
  });

  await testAsync('Czech maintained throughout all turns', async () => {
    let czechTurns = 0;
    for (const r of responses) {
      if (czechRatio(r) > 0.02) czechTurns++;
    }
    // At least 80% of turns should be in Czech
    const pct = responses.length > 0 ? czechTurns / responses.length : 0;
    assert(pct >= 0.8,
      `only ${czechTurns}/${responses.length} turns in Czech (${(pct * 100).toFixed(0)}%)`);
  });

  await testAsync('no metadata leak in any turn', async () => {
    for (let i = 0; i < responses.length; i++) {
      assert(!hasMetadataLeak(responses[i]),
        `metadata leak detected in turn ${i + 1}: ${responses[i].substring(0, 200)}`);
    }
  });

  await testAsync('no identical/copy-paste responses', async () => {
    // No two responses should be >80% similar (no copy-paste)
    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const shorter = Math.min(responses[i].length, responses[j].length);
        if (shorter < 100) continue; // skip very short responses
        // Simple overlap: count shared 20-char substrings
        let overlap = 0;
        const step = 40;
        for (let k = 0; k < responses[i].length - 20; k += step) {
          const chunk = responses[i].substring(k, k + 20);
          if (responses[j].includes(chunk)) overlap++;
        }
        const total = Math.ceil(responses[i].length / step);
        const ratio = total > 0 ? overlap / total : 0;
        assert(ratio < 0.6,
          `T${i + 1} and T${j + 1} are suspiciously similar (${(ratio * 100).toFixed(0)}% overlap)`);
      }
    }
  });

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
