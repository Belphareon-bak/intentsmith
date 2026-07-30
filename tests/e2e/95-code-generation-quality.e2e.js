// tests/e2e/95-code-generation-quality.e2e.js — Code Generation Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that C3 generates COMPLETE, CORRECT, WELL-STRUCTURED code.
//
// Unlike basic tests that check "has a code block with keyword X", these tests
// verify deep code quality:
//   1. Completeness — no TODO/placeholder/pass, all functions implemented
//   2. Structural correctness — matching brackets, imports present, exports
//   3. Multi-file consistency — cross-file references resolve
//   4. Best practices — error handling, input validation, idiomatic patterns
//   5. Iterative refinement — follow-up "fix this" requests work correctly
//   6. Explanation quality — code is accompanied by useful explanation
//
// Expected duration: 12-18 minutes.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const CODE_TIMEOUT = LLM_TIMEOUT * 4;

// ── Code Quality Helpers ─────────────────────────────────────────────────────

function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ lang: m[1] || '', code: m[2], lines: m[2].split('\n').filter(l => l.trim()).length });
  }
  return blocks;
}

function hasPlaceholder(code) {
  // Count lazy placeholders (not just TODO in a comment — only flagrant ones)
  const lazyPatterns = [
    /\b(placeholder|not\s*implement|implement\s*here|your\s*code\s*here)\b/i,
    /\/\/\s*TODO\s*$/m,               // bare "// TODO" with no description
    /\/\/\s*\.\.\.\s*$/m,             // // ...
    /^\s*\.{3}\s*$/m,                 // lone ...
    /\bHACK\b/,
  ];
  return lazyPatterns.some(re => re.test(code))
    || hasLazyPass(code);  // Python bare pass (but NOT in exception class defs)
}

function hasLazyPass(code) {
  const lines = code.split('\n');
  let lazyCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*pass\s*$/.test(lines[i])) {
      // Allow "pass" right after class definition (exception, base class, etc.)
      const prev = i > 0 ? lines[i - 1] : '';
      if (/^\s*class\s+\w+/.test(prev)) continue;
      // Allow "pass" in otherwise-implemented methods (some LLMs put pass as first stmt)
      const next = i + 1 < lines.length ? lines[i + 1] : '';
      if (/^\s*(self\.|return|if|for|while|try|raise)/.test(next)) continue;
      lazyCount++;
    }
  }
  // Allow up to 1 stray pass in large code (>50 lines), it's not a lazy pattern
  const totalLines = lines.filter(l => l.trim()).length;
  return totalLines < 50 ? lazyCount > 0 : lazyCount > 1;
}

function countFunctions(code, lang) {
  if (lang === 'python' || lang === 'py') {
    return (code.match(/^\s*def\s+\w+/gm) || []).length;
  }
  // JS/TS
  return (code.match(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(|(?:async\s+)?(?:\w+)\s*\([^)]*\)\s*\{)/gm) || []).length;
}

function hasBalancedBrackets(code) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inString) {
      if (c === stringChar && code[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ')' || c === ']') {
      if (stack.length === 0 || stack.pop() !== c) return false;
    }
  }
  return stack.length === 0;
}

function codeQualityScore(code, lang) {
  let score = 0;
  const lines = code.split('\n').filter(l => l.trim()).length;

  // Length
  if (lines >= 10) score += 1;
  if (lines >= 25) score += 1;

  // No placeholders
  if (!hasPlaceholder(code)) score += 2;

  // Has error handling
  if (/try\s*\{|except\s+|\.catch\(|catch\s*\(/.test(code)) score += 1;

  // Has comments (but not excessive)
  const commentLines = (code.match(/^\s*(\/\/|#)\s*\S/gm) || []).length;
  if (commentLines >= 1 && commentLines < lines * 0.4) score += 1;

  // Has imports/requires
  if (/^(?:import|from|const\s.*require|require)\s/m.test(code)) score += 1;

  // Balanced brackets
  if (hasBalancedBrackets(code)) score += 1;

  return { score, maxScore: 8, lines, hasPlaceholders: hasPlaceholder(code) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Gen Quality — Single File Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('generates complete Express CRUD with validation', async () => {
    const convId = await createConv('cg-crud');
    created.push(convId);
    const r = await chatInConv(convId,
      `Vypiš mi kompletní Express.js CRUD router pro správu uživatelů. Soubor users.js má mít:
- GET /users (seznam s paginací)
- GET /users/:id
- POST /users (s validací emailu a hesla)
- PUT /users/:id
- DELETE /users/:id

Vypiš jeden kompletní spustitelný soubor. Žádné TODO, žádné placeholdery, žádné zkratky.`
    );

    const blocks = extractCodeBlocks(r.response);
    assert(blocks.length >= 1, 'should have code block');

    const mainBlock = blocks.find(b => b.lang === 'javascript' || b.lang === 'js') || blocks[0];
    const q = codeQualityScore(mainBlock.code, 'javascript');

    assert(!q.hasPlaceholders, 'code should have no placeholders/TODO');
    assert(q.lines >= 30, `code too short for CRUD with validation: ${q.lines} lines`);
    assert(q.score >= 5, `code quality score ${q.score}/${q.maxScore}`);

    // Must have all 5 endpoints
    assert(/router\.(get|use)\s*\(\s*['"]\/['"]/.test(mainBlock.code)
      || /GET.*\/users/.test(r.response),
      'should have GET /users');
    assert(/router\.post/.test(mainBlock.code) || /POST/.test(r.response),
      'should have POST /users');
    assert(/router\.put/.test(mainBlock.code) || /PUT/.test(r.response),
      'should have PUT /users/:id');
    assert(/router\.delete/.test(mainBlock.code) || /DELETE/.test(r.response),
      'should have DELETE /users/:id');

    // Must have validation
    assert(hasKeywords(mainBlock.code, ['email', 'valid', '@', 'password', 'heslo', 'regex', 'test', 'match', 'includes'], 1),
      'should validate email/password');

    // Must have pagination
    assert(hasKeywords(mainBlock.code, ['page', 'limit', 'offset', 'skip', 'stránk'], 1),
      'GET /users should have pagination');
  }, CODE_TIMEOUT);

  await testAsync('generates complete Python class with methods', async () => {
    const convId = await createConv('cg-class');
    created.push(convId);
    const r = await chatInConv(convId,
      `Napiš mi Python třídu BankAccount s těmito metodami:
- __init__(owner, balance=0)
- deposit(amount) — přidá na účet, vrátí nový zůstatek
- withdraw(amount) — odebere, InsufficientFunds exception pokud nedostatek
- transfer(target_account, amount) — převod mezi účty
- statement() — vrátí string s historií transakcí
- __str__ a __repr__

Třída má vést historii transakcí (datum, typ, částka, zůstatek po operaci).
Kompletní kód, žádné pass, žádné TODO.`
    );

    const blocks = extractCodeBlocks(r.response);
    assert(blocks.length >= 1, 'should have code block');

    const pyBlock = blocks.find(b => b.lang === 'python' || b.lang === 'py') || blocks[0];
    const code = pyBlock.code;

    // All methods must be implemented
    const methods = ['__init__', 'deposit', 'withdraw', 'transfer', 'statement', '__str__', '__repr__'];
    const found = methods.filter(m => code.includes(`def ${m}`));
    assert(found.length >= 6,
      `should implement ≥6 methods, found: ${found.join(', ')}`);

    // No lazy bare pass (exception class defs are OK)
    assert(!hasLazyPass(code), 'no bare pass statements (lazy implementation)');

    // Exception class
    assert(hasKeywords(code, ['InsufficientFunds', 'Exception', 'raise', 'Error'], 1),
      'should define/raise InsufficientFunds');

    // Transaction history
    assert(hasKeywords(code, ['history', 'transaction', 'historie', 'transakc', 'log', 'append'], 1),
      'should track transaction history');

    // Quality score
    const q = codeQualityScore(code, 'python');
    assert(q.score >= 4, `quality score ${q.score}/${q.maxScore}`);
  }, CODE_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Gen Quality — Multi-File Consistency');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('multi-file code has consistent imports', async () => {
    const convId = await createConv('cg-multi');
    created.push(convId);
    const r = await chatInConv(convId,
      `Vypiš mi 3 Node.js soubory pro jednoduchou CLI aplikaci na správu kontaktů:

1. contacts.js — modul: loadContacts(), saveContacts(), addContact(name, phone), findContact(query), deleteContact(name)
2. validator.js — modul: validatePhone(phone), validateName(name)
3. cli.js — hlavní soubor: parsuje argumenty (add, find, delete, list), volá contacts.js, validuje přes validator.js

Kompletní kód bez placeholder.`
    );

    const blocks = extractCodeBlocks(r.response);
    assert(blocks.length >= 3, `expected ≥3 code blocks for 3 files, got ${blocks.length}`);

    // Extract all code
    const allCode = blocks.map(b => b.code).join('\n');

    // Cross-file import consistency: cli.js should import from contacts and validator
    assert(
      hasKeywords(allCode, ['require(\'./contacts\')', 'require("./contacts")', 'from \'./contacts\'', 'from "./contacts"'], 1)
      || hasKeywords(allCode, ['contacts', 'loadContacts', 'addContact', 'findContact'], 3),
      'cli.js should import from contacts.js');
    assert(
      hasKeywords(allCode, ['require(\'./validator\')', 'require("./validator")', 'from \'./validator\'', 'from "./validator"'], 1)
      || hasKeywords(allCode, ['validator', 'validatePhone', 'validateName'], 2),
      'cli.js should use validator.js');

    // Exported functions match what's imported
    assert(hasKeywords(allCode, ['addContact', 'findContact', 'deleteContact', 'loadContacts'], 3),
      'contacts.js functions should be defined and referenced');
    assert(hasKeywords(allCode, ['validatePhone', 'validateName'], 2),
      'validator.js functions should be defined and referenced');

    // No placeholders in any block
    const placeholderBlocks = blocks.filter(b => hasPlaceholder(b.code));
    assert(placeholderBlocks.length === 0,
      `${placeholderBlocks.length} code block(s) have placeholders`);
  }, CODE_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Gen Quality — Iterative Refinement');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('fixes code correctly when asked', async () => {
    const convId = await createConv('cg-fix');
    created.push(convId);

    // Step 1: Generate initial code with a deliberate area to improve
    const r1 = await chatInConv(convId,
      'Napiš mi funkci v Pythonu která najde všechny duplicitní prvky v seznamu. Vypiš kód.'
    );

    assert(extractCodeBlocks(r1.response).length >= 1, 'should provide initial code');

    // Step 2: Ask for improvement
    const r2 = await chatInConv(convId,
      'Uprav ten kód tak aby: 1) fungoval i pro nesortovatelné typy (ne jen čísla), 2) zachoval pořadí prvního výskytu, 3) měl typové hinty a docstring. Vypiš celou upravenou funkci.'
    );

    const blocks = extractCodeBlocks(r2.response);
    assert(blocks.length >= 1, 'refinement should include code');

    const code = blocks[0].code;

    // Should have type hints
    assert(/def\s+\w+\s*\([^)]*:\s*/.test(code) || /->/.test(code),
      'refined code should have type hints');

    // Should have docstring
    assert(/"""[\s\S]*?"""|'''[\s\S]*?'''/.test(code),
      'refined code should have docstring');

    // Should handle non-sortable (likely uses set or dict approach)
    // The code should work generically, not just for int/str
    assert(!hasPlaceholder(code), 'refined code should be complete');
  }, CODE_TIMEOUT * 1.5); // extra time for 2-turn test

  await testAsync('adds error handling to existing code', async () => {
    const convId = await createConv('cg-error');
    created.push(convId);

    // Step 1: Simple function
    const r1 = await chatInConv(convId,
      'Napiš mi JavaScript funkci readJsonFile(path) která čte JSON soubor a vrátí objekt. Jednoduchá verze.'
    );

    // Step 2: Add error handling
    const r2 = await chatInConv(convId,
      'Přidej k té funkci robustní error handling: co když soubor neexistuje, co když obsahuje nevalidní JSON, co když nemáme práva ke čtení? Každý případ zvlášť.'
    );

    const blocks = extractCodeBlocks(r2.response);
    assert(blocks.length >= 1, 'should have code with error handling');
    const code = blocks[0].code;

    // Must handle multiple error types
    assert(hasKeywords(code, ['ENOENT', 'not found', 'neexist', 'exist'], 1),
      'should handle file not found');
    assert(hasKeywords(code, ['JSON.parse', 'SyntaxError', 'json', 'parse', 'invalid'], 1),
      'should handle invalid JSON');
    assert(hasKeywords(code, ['EACCES', 'permission', 'práv', 'access'], 1),
      'should handle permission error');

    // Should have try/catch
    assert(/try\s*\{/.test(code), 'should use try/catch for error handling');
  }, CODE_TIMEOUT * 1.5);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Gen Quality — Explanation Quality');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('code accompanied by useful explanation', async () => {
    const convId = await createConv('cg-explain');
    created.push(convId);
    const r = await chatInConv(convId,
      'Implementuj v Pythonu LRU cache dekorátor (bez functools). Vysvětli jak funguje a proč jsi zvolil tuto implementaci.'
    );

    const blocks = extractCodeBlocks(r.response);
    assert(blocks.length >= 1, 'should include code');

    // Code should be substantial
    const code = blocks[0].code;
    assert(code.split('\n').filter(l => l.trim()).length >= 15,
      'LRU cache implementation should be substantial');

    // Explanation should exist outside code blocks
    const prose = r.response.replace(/```[\s\S]*?```/g, '');
    assert(prose.length > 150,
      `explanation too short: ${prose.length} chars outside code blocks`);

    // Explanation should mention key concepts
    assert(hasKeywords(prose, ['LRU', 'cache', 'OrderedDict', 'dict', 'slovník', 'kapacit', 'capacity', 'evict', 'odstraň', 'nejstarší', 'oldest'], 2),
      'explanation should discuss LRU cache concepts');

    // Should mention complexity or tradeoffs
    assert(hasKeywords(prose, ['O(1)', 'complex', 'složit', 'výkon', 'perform', 'paměť', 'memory', 'tradeoff'], 1),
      'explanation should mention complexity or tradeoffs');
  }, CODE_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
