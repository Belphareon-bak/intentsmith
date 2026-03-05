// Architecture Pattern Detector v1 — Heuristic framework/layer/convention detection
// ══════════════════════════════════════════════════════════════════════════════
//
// Regex-based detection of:
//   - Framework (Express, Spring, Django, Flask, Svelte, React, etc.)
//   - Layers (controller, service, repository, model, middleware, etc.)
//   - Patterns (MVC, REST, event-driven, pub-sub, etc.)
//   - Conventions (export style, async style, test framework)
//
// Input: array of { file, content?, imports? } objects
// Output: { framework, layers, patterns, conventions, summary }
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── Framework Detection ────────────────────────────────────────────────────

const FRAMEWORK_SIGNATURES = [
  // Node.js / JS
  { name: 'Express',      importPattern: /\bexpress\b/,                    filePattern: null },
  { name: 'Fastify',      importPattern: /\bfastify\b/,                    filePattern: null },
  { name: 'Koa',          importPattern: /\bkoa\b/,                        filePattern: null },
  { name: 'NestJS',       importPattern: /\b@nestjs\//,                    filePattern: /\.module\.ts$/ },
  { name: 'Next.js',      importPattern: /\bnext\//,                       filePattern: /pages\/|app\/.*page\.[jt]sx?$/ },
  { name: 'Nuxt',         importPattern: /\bnuxt\b/,                       filePattern: /\.nuxt|nuxt\.config/ },
  { name: 'React',        importPattern: /\breact\b/,                      filePattern: null },
  { name: 'Vue',          importPattern: /\bvue\b/,                        filePattern: /\.vue$/ },
  { name: 'Svelte',       importPattern: /\bsvelte\b/,                     filePattern: /\.svelte$/ },
  { name: 'Angular',      importPattern: /\b@angular\//,                   filePattern: /\.component\.ts$/ },
  { name: 'Electron',     importPattern: /\belectron\b/,                   filePattern: /preload\.[jt]s$/ },
  // Python
  { name: 'Django',       importPattern: /\bdjango\b/,                     filePattern: /views\.py$|models\.py$|urls\.py$/ },
  { name: 'Flask',        importPattern: /\bflask\b/,                      filePattern: null },
  { name: 'FastAPI',      importPattern: /\bfastapi\b/,                    filePattern: null },
  // Java/JVM
  { name: 'Spring',       importPattern: /org\.springframework/,           filePattern: /Controller\.java$|Service\.java$/ },
  { name: 'Quarkus',      importPattern: /io\.quarkus/,                    filePattern: null },
  // Go
  { name: 'Gin',          importPattern: /github\.com\/gin-gonic\/gin/,    filePattern: null },
  { name: 'Echo',         importPattern: /github\.com\/labstack\/echo/,    filePattern: null },
  { name: 'Fiber',        importPattern: /github\.com\/gofiber\/fiber/,    filePattern: null },
  // Rust
  { name: 'Actix',        importPattern: /actix[_-]web/,                   filePattern: null },
  { name: 'Axum',         importPattern: /\baxum\b/,                       filePattern: null },
];

// ─── Layer Detection ────────────────────────────────────────────────────────

const LAYER_PATTERNS = [
  { name: 'controller',  pathPattern: /(?:controllers?|handlers?|routes?|endpoints?|api)\//i, contentPattern: /\b(?:@(?:Get|Post|Put|Delete|Controller|RequestMapping)|app\.(get|post|put|delete|patch)\s*\(|router\.(get|post|put|delete))\b/ },
  { name: 'service',     pathPattern: /(?:services?|usecases?|business)\//i,                  contentPattern: /\b(?:@Service|@Injectable|class\s+\w+Service)\b/ },
  { name: 'repository',  pathPattern: /(?:repositor(?:y|ies)|dao|data)\//i,                   contentPattern: /\b(?:@Repository|\.find(?:One|All|By)|\.query|\.exec)\b/ },
  { name: 'model',       pathPattern: /(?:models?|entities?|domain|schema)\//i,                contentPattern: /\b(?:@Entity|Schema|mongoose\.model|class\s+\w+(?:Model|Entity))\b/ },
  { name: 'middleware',   pathPattern: /(?:middlewar(?:e|es))\//i,                             contentPattern: /\b(?:app\.use\(|next\(\)|@Middleware)\b/ },
  { name: 'config',      pathPattern: /(?:config|settings|env)\//i,                           contentPattern: /\b(?:process\.env|os\.environ|@Configuration|dotenv)\b/ },
  { name: 'test',        pathPattern: /(?:tests?|__tests__|spec)\//i,                         contentPattern: /\b(?:describe|it|test|expect|assert|@Test|def test_)\b/ },
  { name: 'migration',   pathPattern: /(?:migrations?|migrate)\//i,                           contentPattern: /\b(?:CREATE TABLE|ALTER TABLE|exports\.up)\b/ },
  { name: 'view',        pathPattern: /(?:views?|templates?|pages?|components?)\//i,           contentPattern: /\b(?:render|template|<template>|return\s+\(?\s*<)\b/ },
  { name: 'util',        pathPattern: /(?:utils?|helpers?|lib|common|shared)\//i,              contentPattern: null },
];

// ─── Pattern Detection ──────────────────────────────────────────────────────

const ARCHITECTURE_PATTERNS = [
  { name: 'MVC',           requires: ['controller', 'model', 'view'] },
  { name: 'REST API',      requires: ['controller', 'service'],      contentHint: /\b(?:app\.(get|post|put|delete)|router\.(get|post)|@RequestMapping)\b/ },
  { name: 'Repository',    requires: ['repository'],                  contentHint: /\b(?:findAll|findById|save|delete|\.query)\b/ },
  { name: 'Middleware',     requires: ['middleware'],                  contentHint: /\bapp\.use\b/ },
  { name: 'Event-Driven',  requires: [],                              contentHint: /(?:EventEmitter|\.on\s*\(|\.emit\s*\(|@EventListener|addEventListener)/ },
  { name: 'Pub-Sub',       requires: [],                              contentHint: /\b(?:subscribe|publish|pubsub|broker|channel|topic)\b/i },
  { name: 'DI',            requires: [],                              contentHint: /(?:@Inject|@Injectable|inversify|inject|provide|container\.bind)/ },
  { name: 'ORM',           requires: [],                              contentHint: /\b(?:sequelize|typeorm|prisma|mongoose|knex|sqlalchemy|hibernate)\b/i },
];

// ─── Convention Detection ───────────────────────────────────────────────────

function detectConventions(files) {
  const conventions = {};
  let esmCount = 0, cjsCount = 0;
  let asyncAwait = 0, callback = 0, promise = 0;
  let jestCount = 0, mochaCount = 0, vitestCount = 0, pytestCount = 0, customCount = 0;

  for (const f of files) {
    const c = f.content || '';
    // Export style
    if (/\bexport\s+(?:default|function|class|const)\b/.test(c) || /\bexport\s*\{/.test(c)) esmCount++;
    if (/\bmodule\.exports\b/.test(c) || /\bexports\.\w+/.test(c)) cjsCount++;
    // Async style
    if (/\basync\s+function\b|\basync\s*\(/.test(c)) asyncAwait++;
    if (/\bfunction\s*\w*\s*\([^)]*callback[^)]*\)/i.test(c)) callback++;
    if (/\.then\s*\(/.test(c) && !/async/.test(c)) promise++;
    // Test framework
    if (/\b(?:jest|expect\()/.test(c) && /\b(?:describe|it|test)\b/.test(c)) jestCount++;
    if (/\bmocha\b|chai/.test(c)) mochaCount++;
    if (/\bvitest\b/.test(c)) vitestCount++;
    if (/\bpytest\b|def test_/.test(c)) pytestCount++;
    if (/\bsuite\s*\(|testAsync\s*\(/.test(c)) customCount++;
  }

  // Export style
  if (esmCount > 0 || cjsCount > 0) {
    conventions.exportStyle = esmCount >= cjsCount ? 'ESM (import/export)' : 'CommonJS (require/module.exports)';
    if (esmCount > 0 && cjsCount > 0) conventions.exportStyle += ' (mixed)';
  }

  // Async style
  const asyncStyles = [];
  if (asyncAwait > 0) asyncStyles.push('async/await');
  if (promise > 0) asyncStyles.push('Promise.then');
  if (callback > 0) asyncStyles.push('callbacks');
  if (asyncStyles.length > 0) conventions.asyncStyle = asyncStyles.join(' + ');

  // Test framework
  const testFw = [];
  if (jestCount > 0) testFw.push('Jest');
  if (mochaCount > 0) testFw.push('Mocha/Chai');
  if (vitestCount > 0) testFw.push('Vitest');
  if (pytestCount > 0) testFw.push('pytest');
  if (customCount > 0) testFw.push('custom harness');
  if (testFw.length > 0) conventions.testFramework = testFw.join(', ');

  return conventions;
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Detect architecture patterns from a set of files.
 *
 * @param {Array<{file: string, content?: string, imports?: string[]}>} files
 * @returns {{ framework: string[], layers: Object<string, string[]>, patterns: string[], conventions: Object, summary: string }}
 */
export function detectArchitecture(files) {
  if (!files || files.length === 0) {
    return { framework: [], layers: {}, patterns: [], conventions: {}, summary: '' };
  }

  // ─── Frameworks ─────────────────────────────────────────────────────
  const frameworkHits = new Map();

  for (const f of files) {
    const allImports = (f.imports || []).join(' ');
    const content = f.content || '';
    const combined = allImports + ' ' + content;

    for (const sig of FRAMEWORK_SIGNATURES) {
      if (sig.importPattern.test(combined)) {
        frameworkHits.set(sig.name, (frameworkHits.get(sig.name) || 0) + 1);
      }
      if (sig.filePattern && sig.filePattern.test(f.file)) {
        frameworkHits.set(sig.name, (frameworkHits.get(sig.name) || 0) + 1);
      }
    }
  }

  // Sort by hit count, take top 3
  const framework = [...frameworkHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  // ─── Layers ─────────────────────────────────────────────────────────
  const layers = {};

  for (const f of files) {
    const content = f.content || '';

    for (const lp of LAYER_PATTERNS) {
      const pathMatch = lp.pathPattern.test(f.file);
      const contentMatch = lp.contentPattern ? lp.contentPattern.test(content) : false;

      if (pathMatch || contentMatch) {
        if (!layers[lp.name]) layers[lp.name] = [];
        if (layers[lp.name].length < 5) { // cap examples per layer
          layers[lp.name].push(f.file);
        }
      }
    }
  }

  // ─── Patterns ───────────────────────────────────────────────────────
  const patterns = [];
  const detectedLayers = new Set(Object.keys(layers));
  const allContent = files.map(f => f.content || '').join('\n');

  for (const ap of ARCHITECTURE_PATTERNS) {
    const layersMatch = ap.requires.every(r => detectedLayers.has(r));
    const contentMatch = ap.contentHint ? ap.contentHint.test(allContent) : false;

    if (layersMatch && (ap.requires.length > 0 || contentMatch)) {
      patterns.push(ap.name);
    }
  }

  // ─── Conventions ────────────────────────────────────────────────────
  const conventions = detectConventions(files);

  // ─── Summary ────────────────────────────────────────────────────────
  const summary = buildSummary(framework, layers, patterns, conventions);

  return { framework, layers, patterns, conventions, summary };
}

// ─── Summary Builder ────────────────────────────────────────────────────────

function buildSummary(framework, layers, patterns, conventions) {
  const parts = [];

  if (framework.length > 0) {
    parts.push(`**Framework:** ${framework.join(', ')}`);
  }

  const layerNames = Object.keys(layers);
  if (layerNames.length > 0) {
    parts.push(`**Layers:** ${layerNames.join(', ')}`);
  }

  if (patterns.length > 0) {
    parts.push(`**Patterns:** ${patterns.join(', ')}`);
  }

  if (conventions.exportStyle) parts.push(`**Exports:** ${conventions.exportStyle}`);
  if (conventions.asyncStyle) parts.push(`**Async:** ${conventions.asyncStyle}`);
  if (conventions.testFramework) parts.push(`**Testing:** ${conventions.testFramework}`);

  return parts.join('\n');
}

/**
 * Format architecture detection for BUILD prompt injection.
 *
 * @param {{ framework: string[], layers: Object, patterns: string[], conventions: Object, summary: string }} arch
 * @returns {string}
 */
export function formatArchitectureForPrompt(arch) {
  if (!arch || (arch.framework.length === 0 && Object.keys(arch.layers).length === 0)) {
    return '';
  }

  const parts = ['## Detected Architecture'];
  parts.push(arch.summary);

  // Layer examples (compact)
  const layerEntries = Object.entries(arch.layers);
  if (layerEntries.length > 0) {
    parts.push('\n**Layer examples:**');
    for (const [layer, examples] of layerEntries) {
      parts.push(`- ${layer}: ${examples.slice(0, 3).join(', ')}`);
    }
  }

  parts.push('\nFollow the existing architecture and conventions when generating code.');

  return parts.join('\n');
}

// ─── Pattern Mining ──────────────────────────────────────────────────────────

// Structural pattern signatures to mine from code
const STRUCTURAL_PATTERNS = [
  { name: 'controller', signature: /(?:app\.(get|post|put|delete|patch)\s*\(|@(?:Get|Post|Put|Delete|Patch|RequestMapping)|router\.)/, fileHint: /controller|handler|route/i },
  { name: 'error-handling', signature: /(?:catch\s*\(|\.catch\s*\(|except\s+\w+|try\s*\{)/, fileHint: null },
  { name: 'logging', signature: /(?:logger\.\w+\(|console\.\w+\(|log\.\w+\(|logging\.\w+\()/, fileHint: null },
  { name: 'middleware', signature: /(?:app\.use\s*\(|@Middleware|@UseGuards|\.use\s*\()/, fileHint: /middleware/i },
  { name: 'validation', signature: /(?:validate|Joi\.|zod\.|z\.\w+\(\)|@IsString|@IsNotEmpty|schema\.validate)/, fileHint: /valid/i },
  { name: 'authentication', signature: /(?:jwt|passport|auth|token|Bearer|bcrypt|argon2)/i, fileHint: /auth/i },
  { name: 'database-query', signature: /(?:\.query\s*\(|\.exec\s*\(|\.findOne\(|\.findMany\(|SELECT\s|INSERT\s|UPDATE\s|DELETE\s)/i, fileHint: /repo|dao|data/i },
  { name: 'test', signature: /(?:describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert[.(])/, fileHint: /test|spec/i },
];

/**
 * Mine recurring structural patterns from codebase files.
 * Returns pattern name → examples with frequency.
 *
 * @param {Array<{file: string, content?: string}>} files
 * @returns {Array<{patternName: string, examples: Array<{file: string, snippet: string}>, frequency: number}>}
 */
export function minePatterns(files) {
  if (!files || files.length === 0) return [];

  const patternResults = new Map();

  for (const f of files) {
    const content = f.content || '';
    if (!content) continue;

    for (const sp of STRUCTURAL_PATTERNS) {
      const sigMatch = sp.signature.test(content);
      const fileMatch = sp.fileHint ? sp.fileHint.test(f.file) : false;

      if (sigMatch || fileMatch) {
        if (!patternResults.has(sp.name)) {
          patternResults.set(sp.name, { patternName: sp.name, examples: [], frequency: 0 });
        }
        const pr = patternResults.get(sp.name);
        pr.frequency++;

        // Extract a snippet showing the pattern (first match + context)
        if (pr.examples.length < 3) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (sp.signature.test(lines[i])) {
              const snippet = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 4)).join('\n');
              pr.examples.push({ file: f.file, snippet: snippet.substring(0, 300) });
              break;
            }
          }
        }
      }
    }
  }

  // Sort by frequency, filter out rare patterns (< 2 occurrences)
  return [...patternResults.values()]
    .filter(p => p.frequency >= 2)
    .sort((a, b) => b.frequency - a.frequency);
}

/**
 * Format mined patterns for BUILD prompt injection.
 * @param {Array} patterns - From minePatterns()
 * @returns {string}
 */
export function formatPatternsForPrompt(patterns) {
  if (!patterns || patterns.length === 0) return '';

  const parts = ['### Detected Code Patterns'];
  for (const p of patterns.slice(0, 5)) {
    parts.push(`\n**${p.patternName}** (${p.frequency} occurrences):`);
    for (const ex of p.examples.slice(0, 2)) {
      parts.push(`\`${ex.file}\`:`);
      parts.push('```');
      parts.push(ex.snippet);
      parts.push('```');
    }
  }
  parts.push('\nFollow these existing patterns for consistency.');
  return parts.join('\n');
}

export default { detectArchitecture, formatArchitectureForPrompt, minePatterns, formatPatternsForPrompt };
