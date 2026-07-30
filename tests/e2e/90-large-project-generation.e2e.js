// tests/e2e/90-large-project-generation.e2e.js — Large Project Code Generation & Consistency
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Comprehensive test for multi-file project generation via chat.
// Tests that C3 can:
//   1. Generate a coherent multi-file project structure
//   2. Produce complete, non-placeholder code
//   3. Maintain import consistency across files
//   4. Handle deep follow-up (add feature, analyze code)
//   5. Provide high-quality code analysis
//
// Expected duration: 5-10 minutes (multiple LLM calls).
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatWithTimeout, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const LONG_TIMEOUT = LLM_TIMEOUT * 3;    // 180s per turn
const PROJECT_TIMEOUT = LLM_TIMEOUT * 5;  // 300s for generation
const LONG_TEST_TIMEOUT = LONG_TIMEOUT + 5_000;
const PROJECT_TEST_TIMEOUT = PROJECT_TIMEOUT + 5_000;
const REQUIRED_PROJECT_FILES = [
  'server.js',
  'routes/books.js',
  'routes/authors.js',
  'models/book.js',
  'models/author.js',
  'middleware/errorHandler.js',
  'middleware/validate.js',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFilename(filename) {
  return filename
    ? filename.replace(/\\/g, '/').replace(/^[./]+/, '').replace(/[`"',:;]+$/g, '')
    : null;
}

function detectFilename(before, code) {
  const recentLines = before.trimEnd().split(/\r?\n/).slice(-4).reverse();
  for (const line of recentLines) {
    const matches = [
      ...line.matchAll(/(?:^|[\s`*])([a-zA-Z_][\w./-]*\.[a-zA-Z0-9]{1,8})(?=[\s`*:;,—-]|$)/g),
    ];
    if (matches.length > 0) return matches[matches.length - 1][1];
  }
  return code.match(/^\/\/\s*(.+\.\w+)/)?.[1] || null;
}

/** Extract fenced code blocks from response: { lang, filename, code } */
function extractCodeBlocks(response) {
  const blocks = [];
  const re = /```(\w*)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(response)) !== null) {
    const lang = m[1] || '';
    const code = m[2];
    // Try to detect filename from comment or header near the block
    const before = response.substring(Math.max(0, m.index - 200), m.index);
    blocks.push({
      lang,
      filename: normalizeFilename(detectFilename(before, code)),
      code,
      lines: code.split('\n').length,
    });
  }
  return blocks;
}

/** Check if code contains placeholder/mock patterns */
function hasMockPatterns(code) {
  const MOCK_RE = /\b(TODO|FIXME|HACK|placeholder|not implemented|implement here|your code here|pass\s*#|\.{3}\s*\/\/|stub|mock data|sample data|\/\/ \.\.\.|in a real|in production)\b/i;
  return MOCK_RE.test(code);
}

function resolveRelativeImport(sourceFilename, importPath) {
  const parts = sourceFilename.split('/');
  parts.pop();
  for (const part of importPath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function hasJsExtension(filename) {
  return /\.(?:js|mjs)$/.test(filename || '');
}

function extractRoutePaths(code, method) {
  const paths = [];
  const routeRe = new RegExp(`\\.${method}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
  for (const match of code.matchAll(routeRe)) paths.push(match[1]);
  return paths;
}

function assertCleanEsModules(blocks, label) {
  const jsBlocks = blocks.filter(block =>
    ['js', 'javascript', 'mjs'].includes(block.lang) || hasJsExtension(block.filename)
  );
  assert(jsBlocks.length >= 5, `${label} should contain at least five JavaScript files`);
  for (const block of jsBlocks) {
    const name = block.filename || '(unnamed)';
    assert(!/\brequire\s*\(|\bmodule\.exports\b|\bexports\./.test(block.code),
      `${name} should not use CommonJS`);
    assert(/\b(?:import|export)\b/.test(block.code),
      `${name} should use ES module import/export syntax`);
  }
}

function assertRelativeImportsResolve(blocks) {
  const filenames = new Set(blocks.map(block => block.filename).filter(Boolean));
  let relativeImportCount = 0;

  for (const block of blocks) {
    assert(block.filename, 'every generated code block must identify its filename');
    const importPaths = [
      ...block.code.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...block.code.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g),
    ].map(match => match[1]);

    for (const importPath of importPaths) {
      relativeImportCount++;
      const resolved = resolveRelativeImport(block.filename, importPath);
      const candidates = resolved
        ? [resolved, `${resolved}.js`, `${resolved}/index.js`]
        : [];
      assert(candidates.some(candidate => filenames.has(candidate)),
        `${block.filename} import ${importPath} does not reference a generated file`);
    }
  }

  assert(relativeImportCount >= 3,
    `project should contain at least three relative imports, got ${relativeImportCount}`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Multi-File Generation');
  // ═══════════════════════════════════════════════════════════════════════════

  let convId;
  let generationResponse = '';
  let codeBlocks = [];

  await testAsync('ask C3 to generate complete Node.js REST API project', async () => {
    convId = await createConv('large-project');
    created.push(convId);

    const r = await chatWithTimeout(convId,
      `Vygeneruj kompletní Node.js REST API projekt pro správu knihovny. Projekt musí mít tyto soubory:

1. server.js — hlavní soubor s Express serverem a registrací routerů
2. routes/books.js — CRUD endpointy pro knihy (GET /books, POST /books, GET /books/:id, PUT /books/:id, DELETE /books/:id)
3. routes/authors.js — CRUD endpointy pro autory
4. models/book.js — model knihy s validací
5. models/author.js — model autora
6. middleware/errorHandler.js — centrální error handler
7. middleware/validate.js — validační middleware

Každý soubor musí být kompletní, funkční, a importy mezi soubory musí být konzistentní.
Použij ES modules (import/export). Vypiš každý soubor v code bloku s jeho názvem.`,
      PROJECT_TIMEOUT,
    );

    assert(r.response.length > 500, `project generation response too short: ${r.response.length}`);
    generationResponse = r.response;

    // Extract code blocks
    codeBlocks = extractCodeBlocks(r.response);
    assert(codeBlocks.length >= 5, `expected ≥5 code blocks for 7-file project, got ${codeBlocks.length}`);
  }, PROJECT_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — File Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('all key files are generated', async () => {
    assert(generationResponse.trim().length > 0, 'project generation response is required');
    assert(codeBlocks.length >= 5,
      `project generation must produce at least five code blocks, got ${codeBlocks.length}`);
    const filenames = new Set(codeBlocks.map(block => block.filename).filter(Boolean));
    for (const filename of REQUIRED_PROJECT_FILES) {
      assert(filenames.has(filename), `project should include ${filename}`);
    }
  });

  await testAsync('code blocks have sufficient length', async () => {
    assert(codeBlocks.length >= 5,
      `code-length check requires at least five generated blocks, got ${codeBlocks.length}`);
    const avgLines = codeBlocks.reduce((s, b) => s + b.lines, 0) / codeBlocks.length;
    assert(avgLines > 5, `average code block too short: ${avgLines.toFixed(1)} lines`);
    // At least one file should be substantial (>15 lines)
    const hasSubstantial = codeBlocks.some(b => b.lines > 15);
    assert(hasSubstantial, 'at least one file should be >15 lines');
  });

  await testAsync('no placeholder/TODO code in generated files', async () => {
    assert(codeBlocks.length >= 5,
      `placeholder check requires at least five generated blocks, got ${codeBlocks.length}`);
    let mockCount = 0;
    const mockFiles = [];
    for (const block of codeBlocks) {
      if (hasMockPatterns(block.code)) {
        mockCount++;
        mockFiles.push(block.filename || '(unnamed)');
      }
    }
    assert(mockCount === 0,
      `${mockCount} files contain placeholder code: ${mockFiles.join(', ')}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Import Consistency');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('import statements use consistent module system', async () => {
    assert(codeBlocks.length >= 5,
      `module-system check requires at least five generated blocks, got ${codeBlocks.length}`);
    assertCleanEsModules(codeBlocks, 'generated project');
  });

  await testAsync('cross-file imports reference existing files', async () => {
    assert(codeBlocks.length >= 5,
      `import-resolution check requires at least five generated blocks, got ${codeBlocks.length}`);
    assertRelativeImportsResolve(codeBlocks);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Code Architecture');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('server file registers routes', async () => {
    assert(codeBlocks.length >= 5,
      `server check requires at least five generated blocks, got ${codeBlocks.length}`);
    const serverBlock = codeBlocks.find(block => block.filename === 'server.js');
    assert(serverBlock, 'project should include a named server.js code block');

    assert(
      serverBlock.code.includes('app.use') || serverBlock.code.includes('app.get'),
      'server should register routes with app.use() or app.get()'
    );
    assert(
      serverBlock.code.includes('listen') || serverBlock.code.includes('createServer'),
      'server should have listen call'
    );
  });

  await testAsync('routes have CRUD operations', async () => {
    assert(codeBlocks.length >= 5,
      `route check requires at least five generated blocks, got ${codeBlocks.length}`);
    for (const filename of ['routes/books.js', 'routes/authors.js']) {
      const routeBlock = codeBlocks.find(block => block.filename === filename);
      assert(routeBlock, `project should include ${filename}`);
      const getPaths = extractRoutePaths(routeBlock.code, 'get');
      const postPaths = extractRoutePaths(routeBlock.code, 'post');
      const putPaths = extractRoutePaths(routeBlock.code, 'put');
      const deletePaths = extractRoutePaths(routeBlock.code, 'delete');
      assert(getPaths.some(route => route === '/' || !route.includes(':id')),
        `${filename} should have a collection GET endpoint`);
      assert(getPaths.some(route => route.includes(':id')),
        `${filename} should have an item GET endpoint`);
      assert(postPaths.length > 0, `${filename} should have a POST endpoint`);
      assert(putPaths.some(route => route.includes(':id')),
        `${filename} should have an item PUT endpoint`);
      assert(deletePaths.some(route => route.includes(':id')),
        `${filename} should have an item DELETE endpoint`);
    }
  });

  await testAsync('error handler uses Express error pattern', async () => {
    assert(codeBlocks.length >= 5,
      `error-handler check requires at least five generated blocks, got ${codeBlocks.length}`);
    const errorBlock = codeBlocks.find(block =>
      block.filename === 'middleware/errorHandler.js'
    );
    assert(errorBlock, 'project should include middleware/errorHandler.js');

    // Express error handler has 4 params: (err, req, res, next)
    assert(
      /\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/.test(errorBlock.code)
      || /function\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/.test(errorBlock.code),
      'error handler should have (err, req, res, next) signature'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Follow-Up: Add Feature');
  // ═══════════════════════════════════════════════════════════════════════════

  let featureResponse = '';

  await testAsync('ask to add search endpoint to existing project', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'search follow-up requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Přidej do routes/books.js endpoint GET /books/search?q=text pro fulltextové vyhledávání knih podle názvu. Vypiš celý aktualizovaný soubor se všemi CRUD endpointy.',
      LONG_TIMEOUT,
    );
    assert(r.response.length > 100, `feature response too short: ${r.response.length}`);
    featureResponse = r.response;

    // Should contain search-related code
    assert(hasKeywords(r.response, ['search', '/search', 'query', 'filter', 'find', 'includes', 'indexOf', 'match'], 1),
      'feature response should contain search logic');
    // Should have code block
    assert(r.response.includes('```'), 'feature response should include code block');
  }, LONG_TEST_TIMEOUT);

  await testAsync('added feature maintains existing CRUD', async () => {
    assert(featureResponse.trim().length > 0, 'search feature response is required');
    const blocks = extractCodeBlocks(featureResponse);
    assert(blocks.length > 0, 'search feature should contain a code block');
    const routeBlock = blocks.find(block => block.filename === 'routes/books.js');
    assert(routeBlock, 'search feature should contain the complete routes/books.js file');
    assert(!hasMockPatterns(routeBlock.code), 'updated routes/books.js should not contain placeholders');
    assert(!/\brequire\s*\(|\bmodule\.exports\b|\bexports\./.test(routeBlock.code),
      'updated routes/books.js should remain an ES module');
    assert(/\b(?:import|export)\b/.test(routeBlock.code),
      'updated routes/books.js should use import/export syntax');
    const getPaths = extractRoutePaths(routeBlock.code, 'get');
    const postPaths = extractRoutePaths(routeBlock.code, 'post');
    const putPaths = extractRoutePaths(routeBlock.code, 'put');
    const deletePaths = extractRoutePaths(routeBlock.code, 'delete');
    assert(getPaths.some(route => /\/search$/.test(route)),
      'updated routes/books.js should define the search endpoint');
    assert(getPaths.some(route => route === '/' || route === '/books'),
      'updated routes/books.js should retain the collection GET endpoint');
    assert(getPaths.some(route => route.includes(':id')),
      'updated routes/books.js should retain the item GET endpoint');
    assert(postPaths.length > 0, 'updated routes/books.js should retain POST');
    assert(putPaths.some(route => route.includes(':id')),
      'updated routes/books.js should retain the item PUT endpoint');
    assert(deletePaths.some(route => route.includes(':id')),
      'updated routes/books.js should retain the item DELETE endpoint');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Deep Code Analysis');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('ask for security review of the project', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'security review requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Proveď bezpečnostní revizi celého projektu. Zkontroluj: SQL injection, validaci vstupů, error handling, a chybějící autentizaci.',
      LONG_TIMEOUT,
    );
    assert(r.response.length > 200, `security review too short: ${r.response.length}`);
    // Should mention at least some security concepts
    assert(hasKeywords(r.response, ['bezpeč', 'security', 'validac', 'autentiz', 'authent', 'input', 'sql', 'inject', 'sanitiz', 'xss', 'middleware', 'chyb', 'error'], 2),
      `security review should cover multiple topics: ${r.response.substring(0, 300)}`);
    // Should identify specific improvements (not just generic advice)
    assert(r.response.length > 300 || r.response.includes('```'),
      'security review should be detailed or include code fixes');
  }, LONG_TEST_TIMEOUT);

  await testAsync('ask for architecture assessment', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'architecture assessment requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Zhodnoť architekturu projektu. Je struktura správná? Dodržuje princip oddělení zodpovědností? Co bys vylepšil?',
      LONG_TIMEOUT,
    );
    assert(r.response.length > 100, `architecture review too short: ${r.response.length}`);
    assert(hasKeywords(r.response, ['architektur', 'struktur', 'oddělení', 'zodpověd', 'separation', 'concern', 'vrst', 'layer', 'model', 'controller', 'route', 'middleware', 'modul'], 2),
      `architecture review should cover structural topics: ${r.response.substring(0, 300)}`);
  }, LONG_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Context Retention');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('remembers project structure after 6+ turns', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'project recall requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Rekapituluj naši konverzaci — jaké kódové soubory jsme tu diskutovali a co každý obsahuje? Odpověz na základě předchozích zpráv v tomto chatu.',
      LONG_TIMEOUT,
    );
    // Should reference the project files from earlier turns
    assert(hasKeywords(r.response, ['server', 'route', 'book', 'author', 'model', 'middleware', 'error'], 2),
      `should remember project files: ${r.response.substring(0, 300)}`);
  }, LONG_TEST_TIMEOUT);

  await testAsync('can reference specific file content', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'endpoint recall requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Vyjmenuj všechny endpointy pro knihy které jsme vytvořili, včetně toho nového search.',
      LONG_TIMEOUT,
    );
    assert(hasKeywords(r.response, ['get', 'post', 'put', 'delete', 'search'], 2),
      `should list CRUD + search endpoints: ${r.response.substring(0, 300)}`);
  }, LONG_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — No Quality Degradation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('no JSON/metadata leak after 8+ turns', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'quality-degradation check requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Shrň mi celý projekt v 5 bodech.',
      LONG_TIMEOUT,
    );
    assert(!r.response.includes('"decision_type"'), 'no JSON decision_type leak');
    assert(!r.response.includes('"intent_type"'), 'no intent_type leak');
    assert(!r.response.includes('"confidence":'), 'no confidence leak');
    assert(r.response.length > 50, 'summary should be substantive');
    assert(r.response.length < 3000, `summary should be concise, got ${r.response.length}`);
  }, LONG_TEST_TIMEOUT);

  await testAsync('response is still in Czech', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'language check requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Jaké jsou hlavní výhody této architektury?',
      LONG_TIMEOUT,
    );
    // Should contain Czech diacritics
    assert(/[ěščřžýáíéůúďťň]/i.test(r.response),
      'response should still be in Czech after many turns');
  }, LONG_TEST_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
