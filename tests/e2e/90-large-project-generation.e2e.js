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
  waitForServer, createConv, chatInConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT, makeOwnedTempDir, removeOwnedTempDir,
} from './_helpers.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';

await waitForServer();

const created = [];
const LONG_TIMEOUT = LLM_TIMEOUT * 3;    // 180s per turn
const PROJECT_TIMEOUT = LLM_TIMEOUT * 5;  // 300s for generation
const tmpDir = makeOwnedTempDir('c3-e2e-large');

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    const fnMatch = before.match(/(?:soubor|file|filename)[:\s]*[`"']?([^\s`"']+\.\w+)/i)
      || before.match(/([a-zA-Z_][\w\-/]*\.\w{1,5})\s*[:]*\s*$/m)
      || code.match(/^\/\/\s*(.+\.\w+)/);
    blocks.push({
      lang,
      filename: fnMatch ? fnMatch[1].trim() : null,
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

/** Count import/require statements */
function countImports(code, lang) {
  if (['js', 'javascript', 'mjs', 'ts', 'typescript'].includes(lang)) {
    return (code.match(/(?:import\s+|require\s*\()/g) || []).length;
  }
  if (['py', 'python'].includes(lang)) {
    return (code.match(/(?:^import\s+|^from\s+)/gm) || []).length;
  }
  if (['go'].includes(lang)) {
    return (code.match(/(?:^import\s+)/gm) || []).length;
  }
  return 0;
}

/** Extract exported names from JS/TS code */
function extractExports(code) {
  const names = [];
  for (const m of code.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g)) {
    names.push(m[1]);
  }
  for (const m of code.matchAll(/module\.exports\s*=\s*\{?\s*(\w+)/g)) {
    names.push(m[1]);
  }
  return names;
}

/** Extract imported names from JS/TS code */
function extractImportedNames(code) {
  const names = [];
  for (const m of code.matchAll(/import\s+\{([^}]+)\}/g)) {
    for (const n of m[1].split(',')) {
      const clean = n.trim().split(/\s+as\s+/).pop().trim();
      if (clean) names.push(clean);
    }
  }
  for (const m of code.matchAll(/import\s+(\w+)/g)) {
    names.push(m[1]);
  }
  return names;
}

/** Write extracted code blocks to temp directory */
function writeCodeFiles(blocks) {
  const files = [];
  for (const block of blocks) {
    if (!block.filename) continue;
    const fullPath = join(tmpDir, block.filename);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, block.code);
    files.push({ path: block.filename, fullPath, code: block.code, lang: block.lang, lines: block.lines });
  }
  return files;
}

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Multi-File Generation');
  // ═══════════════════════════════════════════════════════════════════════════

  let convId;
  let generationResponse = '';
  let codeBlocks = [];
  let writtenFiles = [];

  await testAsync('ask C3 to generate complete Node.js REST API project', async () => {
    convId = await createConv('large-project');
    created.push(convId);

    const r = await chatInConv(convId,
      `Vygeneruj kompletní Node.js REST API projekt pro správu knihovny. Projekt musí mít tyto soubory:

1. server.js — hlavní soubor s Express serverem a registrací routerů
2. routes/books.js — CRUD endpointy pro knihy (GET /books, POST /books, GET /books/:id, PUT /books/:id, DELETE /books/:id)
3. routes/authors.js — CRUD endpointy pro autory
4. models/book.js — model knihy s validací
5. models/author.js — model autora
6. middleware/errorHandler.js — centrální error handler
7. middleware/validate.js — validační middleware

Každý soubor musí být kompletní, funkční, a importy mezi soubory musí být konzistentní.
Použij ES modules (import/export). Vypiš každý soubor v code bloku s jeho názvem.`
    );

    assert(r.response.length > 500, `project generation response too short: ${r.response.length}`);
    generationResponse = r.response;

    // Extract code blocks
    codeBlocks = extractCodeBlocks(r.response);
    assert(codeBlocks.length >= 5, `expected ≥5 code blocks for 7-file project, got ${codeBlocks.length}`);

    // Write to temp files for analysis
    writtenFiles = writeCodeFiles(codeBlocks);
  }, PROJECT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — File Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('all key files are generated', async () => {
    if (!codeBlocks.length) return;
    const filenames = codeBlocks.map(b => b.filename).filter(Boolean).join(' ');
    const allCode = codeBlocks.map(b => b.code).join('\n');
    // Check that essential parts are covered
    const hasServer = filenames.includes('server') || filenames.includes('app') || filenames.includes('index')
      || allCode.includes('express()') || allCode.includes('app.listen') || allCode.includes('createServer')
      || allCode.includes('.listen(');
    const hasRoutes = filenames.includes('route') || filenames.includes('book') || allCode.includes('router.');
    const hasModel = filenames.includes('model') || allCode.includes('class Book') || allCode.includes('class Author');
    assert(hasServer, 'project should include server setup');
    assert(hasRoutes, 'project should include route definitions');
    assert(hasModel || allCode.includes('validat'), 'project should include models or validation');
  });

  await testAsync('code blocks have sufficient length', async () => {
    if (!codeBlocks.length) return;
    const avgLines = codeBlocks.reduce((s, b) => s + b.lines, 0) / codeBlocks.length;
    assert(avgLines > 5, `average code block too short: ${avgLines.toFixed(1)} lines`);
    // At least one file should be substantial (>15 lines)
    const hasSubstantial = codeBlocks.some(b => b.lines > 15);
    assert(hasSubstantial, 'at least one file should be >15 lines');
  });

  await testAsync('no placeholder/TODO code in generated files', async () => {
    if (!codeBlocks.length) return;
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
    if (!codeBlocks.length) return;
    const jsBlocks = codeBlocks.filter(b =>
      ['js', 'javascript', 'mjs'].includes(b.lang) || (b.filename && /\.m?js$/.test(b.filename))
    );
    if (jsBlocks.length < 2) return;

    // Check: either all use import/export OR all use require/module.exports
    let esm = 0, cjs = 0;
    for (const block of jsBlocks) {
      if (/\bimport\s+/.test(block.code) || /\bexport\s+/.test(block.code)) esm++;
      if (/\brequire\s*\(/.test(block.code) || /module\.exports/.test(block.code)) cjs++;
    }
    // Allow mixed only if clearly intentional (e.g., one config file using CJS)
    assert(esm === 0 || cjs === 0 || Math.min(esm, cjs) <= 1,
      `mixed module systems: ${esm} ESM files, ${cjs} CJS files — should be consistent`);
  });

  await testAsync('cross-file imports reference existing files', async () => {
    if (codeBlocks.length < 3) return;
    const allCode = codeBlocks.map(b => b.code).join('\n---FILE-BOUNDARY---\n');
    const filenames = codeBlocks.map(b => b.filename).filter(Boolean);

    // Extract import paths (relative: ./xxx or ../xxx)
    const importPaths = [];
    for (const m of allCode.matchAll(/(?:import|from)\s+['"](\.[^'"]+)['"]/g)) {
      importPaths.push(m[1]);
    }
    for (const m of allCode.matchAll(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      importPaths.push(m[1]);
    }

    if (importPaths.length === 0) return; // No relative imports to check

    // At least some relative imports should reference files from the project
    let resolved = 0;
    for (const imp of importPaths) {
      const base = imp.replace(/^\.\//, '').replace(/^\.\.\//, '');
      const withExt = base.endsWith('.js') ? base : base + '.js';
      const matches = filenames.some(f =>
        f.includes(base) || f.includes(withExt) || f.endsWith('/' + basename(base))
      );
      if (matches) resolved++;
    }
    // At least 50% of relative imports should resolve (accounting for naming variations)
    const resolveRate = importPaths.length > 0 ? resolved / importPaths.length : 1;
    assert(resolveRate >= 0.5 || resolved >= 2,
      `only ${resolved}/${importPaths.length} relative imports resolve (${(resolveRate * 100).toFixed(0)}%)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Code Architecture');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('server file registers routes', async () => {
    if (!codeBlocks.length) return;
    const serverBlock = codeBlocks.find(b =>
      (b.filename && b.filename.includes('server')) || b.code.includes('app.listen')
    );
    if (!serverBlock) return;

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
    if (!codeBlocks.length) return;
    const routeBlocks = codeBlocks.filter(b =>
      (b.filename && (b.filename.includes('route') || b.filename.includes('book') || b.filename.includes('author')))
      || b.code.includes('router.')
    );
    if (routeBlocks.length === 0) return;

    const allRouteCode = routeBlocks.map(b => b.code).join('\n');
    // Should have at least GET and POST
    assert(/\.get\s*\(/.test(allRouteCode), 'routes should have GET endpoint');
    assert(/\.post\s*\(/.test(allRouteCode), 'routes should have POST endpoint');
  });

  await testAsync('error handler uses Express error pattern', async () => {
    if (!codeBlocks.length) return;
    const errorBlock = codeBlocks.find(b =>
      (b.filename && b.filename.includes('error')) || b.code.includes('err, req, res, next')
    );
    if (!errorBlock) return;

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
    if (!convId) return;
    const r = await chatInConv(convId,
      'Přidej do routes/books.js endpoint GET /books/search?q=text pro fulltextové vyhledávání knih podle názvu. Vypiš aktualizovaný soubor.'
    );
    assert(r.response.length > 100, `feature response too short: ${r.response.length}`);
    featureResponse = r.response;

    // Should contain search-related code
    assert(hasKeywords(r.response, ['search', '/search', 'query', 'filter', 'find', 'includes', 'indexOf', 'match'], 1),
      'feature response should contain search logic');
    // Should have code block
    assert(r.response.includes('```'), 'feature response should include code block');
  }, LONG_TIMEOUT);

  await testAsync('added feature maintains existing CRUD', async () => {
    if (!featureResponse) return;
    const blocks = extractCodeBlocks(featureResponse);
    if (blocks.length === 0) return;

    const routeCode = blocks.map(b => b.code).join('\n');
    // Should still have original CRUD operations
    const hasCrud = /\.get\s*\(/.test(routeCode) && /\.post\s*\(/.test(routeCode);
    // OR the response only shows the new endpoint (incremental update)
    const hasSearch = /search|query|hled/.test(routeCode.toLowerCase());
    assert(hasCrud || hasSearch,
      'updated file should maintain CRUD or at least show search endpoint');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Deep Code Analysis');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('ask for security review of the project', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Proveď bezpečnostní revizi celého projektu. Zkontroluj: SQL injection, validaci vstupů, error handling, a chybějící autentizaci.'
    );
    assert(r.response.length > 200, `security review too short: ${r.response.length}`);
    // Should mention at least some security concepts
    assert(hasKeywords(r.response, ['bezpeč', 'security', 'validac', 'autentiz', 'authent', 'input', 'sql', 'inject', 'sanitiz', 'xss', 'middleware', 'chyb', 'error'], 2),
      `security review should cover multiple topics: ${r.response.substring(0, 300)}`);
    // Should identify specific improvements (not just generic advice)
    assert(r.response.length > 300 || r.response.includes('```'),
      'security review should be detailed or include code fixes');
  }, LONG_TIMEOUT);

  await testAsync('ask for architecture assessment', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Zhodnoť architekturu projektu. Je struktura správná? Dodržuje princip oddělení zodpovědností? Co bys vylepšil?'
    );
    assert(r.response.length > 100, `architecture review too short: ${r.response.length}`);
    assert(hasKeywords(r.response, ['architektur', 'struktur', 'oddělení', 'zodpověd', 'separation', 'concern', 'vrst', 'layer', 'model', 'controller', 'route', 'middleware', 'modul'], 2),
      `architecture review should cover structural topics: ${r.response.substring(0, 300)}`);
  }, LONG_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — Context Retention');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('remembers project structure after 6+ turns', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Rekapituluj naši konverzaci — jaké kódové soubory jsme tu diskutovali a co každý obsahuje? Odpověz na základě předchozích zpráv v tomto chatu.'
    );
    // Should reference the project files from earlier turns
    assert(hasKeywords(r.response, ['server', 'route', 'book', 'author', 'model', 'middleware', 'error'], 2),
      `should remember project files: ${r.response.substring(0, 300)}`);
  }, LONG_TIMEOUT);

  await testAsync('can reference specific file content', async () => {
    if (!convId) return;
    const r = await chatInConv(convId,
      'Vyjmenuj všechny endpointy pro knihy které jsme vytvořili, včetně toho nového search.'
    );
    assert(hasKeywords(r.response, ['get', 'post', 'put', 'delete', 'search'], 2),
      `should list CRUD + search endpoints: ${r.response.substring(0, 300)}`);
  }, LONG_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Large Project — No Quality Degradation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('no JSON/metadata leak after 8+ turns', async () => {
    if (!convId) return;
    const r = await chatInConv(convId, 'Shrň mi celý projekt v 5 bodech.');
    assert(!r.response.includes('"decision_type"'), 'no JSON decision_type leak');
    assert(!r.response.includes('"intent_type"'), 'no intent_type leak');
    assert(!r.response.includes('"confidence":'), 'no confidence leak');
    assert(r.response.length > 50, 'summary should be substantive');
    assert(r.response.length < 3000, `summary should be concise, got ${r.response.length}`);
  }, LONG_TIMEOUT);

  await testAsync('response is still in Czech', async () => {
    if (!convId) return;
    const r = await chatInConv(convId, 'Jaké jsou hlavní výhody této architektury?');
    // Should contain Czech diacritics
    assert(/[ěščřžýáíéůúďťň]/i.test(r.response),
      'response should still be in Czech after many turns');
  }, LONG_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
  try { removeOwnedTempDir(tmpDir); } catch {}
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
