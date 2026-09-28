// tests/e2e/_quality-evaluator.js — Shared scoring functions for quality E2E suites
// ══════════════════════════════════════════════════════════════════════════════
// All scoring is DETERMINISTIC (no LLM grading).
// Used by 97-project-build-quality.e2e.js and 98-analysis-quality.e2e.js.
// ══════════════════════════════════════════════════════════════════════════════

// ── Code Block Extraction ───────────────────────────────────────────────────

/** Extract fenced code blocks from markdown response: { lang, filename, code, lines } */
export function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```(\w*)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lang = m[1] || '';
    const code = m[2];
    // Try to detect filename from comment near the block
    const before = text.substring(Math.max(0, m.index - 200), m.index);
    const fnMatch = before.match(/(?:soubor|file|filename)[:\s]*[`"']?([^\s`"']+\.\w+)/i)
      || before.match(/([a-zA-Z_][\w\-/]*\.\w{1,5})\s*[:]*\s*$/m)
      || code.match(/^\/\/\s*(.+\.\w{1,5})\s*$/m)
      || code.match(/^#\s*(.+\.\w{1,5})\s*$/m);
    blocks.push({
      lang,
      filename: fnMatch ? fnMatch[1].trim() : null,
      code,
      lines: code.split('\n').filter(l => l.trim()).length,
    });
  }
  return blocks;
}

/** Assign expected filenames to blocks that lack one.
 *  Single file → all blocks get it. Multi-file → positional matching. */
export function assignFilenames(blocks, expectedFiles) {
  if (!expectedFiles || expectedFiles.length === 0) return blocks;
  if (expectedFiles.length === 1) {
    for (const block of blocks) {
      if (!block.filename) block.filename = expectedFiles[0];
    }
    return blocks;
  }
  let fileIdx = 0;
  for (const block of blocks) {
    if (!block.filename && fileIdx < expectedFiles.length) {
      block.filename = expectedFiles[fileIdx];
      fileIdx++;
    }
  }
  return blocks;
}

/** Merge code blocks: latest version per filename wins. */
export function mergeCodeBlocks(existing, newBlocks) {
  const map = new Map();
  for (const b of existing) { if (b.filename) map.set(b.filename, b); }
  for (const b of newBlocks) { if (b.filename) map.set(b.filename, b); }
  return [...map.values()];
}

// ── Placeholder Detection ───────────────────────────────────────────────────

const PLACEHOLDER_RE = /\b(TODO|FIXME|HACK|placeholder|not\s*implement|implement\s*here|your\s*code\s*here|in a real|in production|stub|mock data|sample data)\b/i;

export function hasPlaceholder(code) {
  if (PLACEHOLDER_RE.test(code)) return true;
  // Python bare pass (but not after Exception class)
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*pass\s*$/.test(lines[i])) {
      const prev = i > 0 ? lines[i - 1] : '';
      if (/^\s*class\s+\w+.*\b(Exception|Error)\b/.test(prev)) continue;
      return true;
    }
  }
  // lone ...
  if (/^\s*\.{3}\s*$/m.test(code)) return true;
  return false;
}

/** Count placeholder occurrences */
export function countPlaceholders(code) {
  let count = 0;
  const matches = code.match(/\b(TODO|FIXME|HACK|placeholder|not\s*implement|implement\s*here|your\s*code\s*here)\b/gi);
  if (matches) count += matches.length;
  return count;
}

// ── Syntax Checking ─────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeOwnedTempDir, removeOwnedTempDir } from './_helpers.js';

function withSyntaxFixture(extension, code, check) {
  const workDir = makeOwnedTempDir('quality-evaluator');
  const fixturePath = join(workDir, `check.${extension}`);
  try {
    writeFileSync(fixturePath, code, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return check(fixturePath);
  } finally {
    removeOwnedTempDir(workDir);
  }
}

function syntaxFailure(error) {
  return {
    ok: false,
    error: error?.stderr?.toString() || error?.stdout?.toString() || error?.message || String(error),
  };
}

/** Check JS syntax via node --check. Returns { ok, error } */
export function checkJsSyntax(code) {
  try {
    return withSyntaxFixture('js', code, (fixturePath) => {
      execFileSync(process.execPath, ['--check', fixturePath], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 5000,
      });
      return { ok: true, error: null };
    });
  } catch (e) {
    return syntaxFailure(e);
  }
}

/** Check Python syntax via py_compile. Returns { ok, error } */
export function checkPySyntax(code) {
  try {
    return withSyntaxFixture('py', code, (fixturePath) => {
      execFileSync('python3', ['-m', 'py_compile', fixturePath], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 5000,
      });
      return { ok: true, error: null };
    });
  } catch (e) {
    return syntaxFailure(e);
  }
}

/** Check syntax for supported languages. Returns { ok, error } or null if unsupported. */
export function checkSyntax(code, lang) {
  const l = (lang || '').toLowerCase();
  if (['js', 'javascript', 'mjs', 'cjs', 'node'].includes(l)) return checkJsSyntax(code);
  if (['py', 'python'].includes(l)) return checkPySyntax(code);
  if (['html', 'jinja2', 'jinja', 'htm'].includes(l)) {
    const s = scoreTemplate(code);
    return { ok: s >= 30, error: s < 30 ? 'template score too low' : null };
  }
  if (['json'].includes(l)) {
    try { JSON.parse(code); return { ok: true, error: null }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  return null; // Unsupported — skip
}

// ── Import Consistency ──────────────────────────────────────────────────────

/** Check JS import consistency across code blocks.
 *  Returns { resolved, unresolved: [{ file, target }] } */
export function checkJsImports(codeBlocks) {
  const fileMap = new Map();
  for (const block of codeBlocks) {
    if (block.filename) fileMap.set(block.filename, block.code);
  }

  const IMPORT_RE = /(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\))|(?:from\s+['"](\.[^'"]+)['"])/g;
  let resolved = 0;
  const unresolved = [];

  for (const [filename, code] of fileMap) {
    let m;
    const re = new RegExp(IMPORT_RE.source, 'g');
    while ((m = re.exec(code)) !== null) {
      const target = m[1] || m[2];
      // Check if target resolves to any known file
      const candidates = [target, target + '.js', target + '.mjs', target + '/index.js'];
      const found = candidates.some(c => {
        // Normalize: resolve from file's directory
        const dir = filename.includes('/') ? filename.substring(0, filename.lastIndexOf('/')) : '';
        const resolved = normalizePath(dir ? dir + '/' + c : c);
        return fileMap.has(resolved) || fileMap.has(resolved.replace(/^\.\//, ''));
      });
      if (found) {
        resolved++;
      } else {
        // Don't flag node_modules or absolute imports
        if (!target.startsWith('.')) continue;
        unresolved.push({ file: filename, target });
      }
    }
  }
  return { resolved, unresolved };
}

function normalizePath(p) {
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.') result.push(part);
  }
  return result.join('/');
}

/** Check Python import consistency across code blocks (local imports only).
 *  Returns { resolved, unresolved: [{ file, target }] } */
export function checkPyImports(codeBlocks) {
  const moduleNames = new Set();
  for (const block of codeBlocks) {
    if (block.filename?.endsWith('.py')) {
      moduleNames.add(block.filename.replace(/\.py$/, '').replace(/\//g, '.'));
      moduleNames.add(block.filename.replace(/\.py$/, ''));
    }
  }

  const IMPORT_RE = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let resolved = 0;
  const unresolved = [];

  for (const block of codeBlocks) {
    if (!block.filename?.endsWith('.py')) continue;
    let m;
    const re = new RegExp(IMPORT_RE.source, 'gm');
    while ((m = re.exec(block.code)) !== null) {
      const target = m[1] || m[2];
      // Skip stdlib and common third-party
      if (isStdlibOrThirdParty(target)) continue;
      if (moduleNames.has(target)) {
        resolved++;
      } else {
        unresolved.push({ file: block.filename, target });
      }
    }
  }
  return { resolved, unresolved };
}

const PY_KNOWN = new Set([
  'flask', 'django', 'requests', 'sqlite3', 'json', 'os', 'sys', 'time',
  'datetime', 're', 'math', 'random', 'logging', 'pathlib', 'collections',
  'typing', 'dataclasses', 'abc', 'functools', 'itertools', 'hashlib',
  'hmac', 'secrets', 'uuid', 'unittest', 'pytest', 'io', 'csv',
  'argparse', 'textwrap', 'shutil', 'tempfile', 'subprocess',
  'jinja2', 'werkzeug', 'sqlalchemy', 'bcrypt', 'jwt',
  'render_template', 'render_template_string',
]);

function isStdlibOrThirdParty(name) {
  const base = name.split('.')[0];
  return PY_KNOWN.has(base);
}

// ── Template Scoring ────────────────────────────────────────────────────────

/** Score HTML/Jinja2 template quality. Returns 0–100. */
export function scoreTemplate(code) {
  let score = 0;
  if (/<html|<!DOCTYPE/i.test(code)) score += 10;
  if (/\{%\s*extends|{% block/i.test(code)) score += 20;
  if (/<form|<input|<button/i.test(code)) score += 15;
  if (/class=|href=|src=/i.test(code)) score += 10;
  const opens = (code.match(/<(?!\/|!|br|hr|img|input|meta|link)[a-z]+/gi) || []).length;
  const closes = (code.match(/<\/[a-z]+>/gi) || []).length;
  if (opens > 0 && Math.abs(opens - closes) <= opens * 0.3) score += 15;
  if (!hasPlaceholder(code)) score += 10;
  return Math.min(100, score);
}

/** Score config file quality. Returns 0–100. */
export function scoreConfigFile(code, type) {
  const t = (type || '').toLowerCase();
  if (t === 'package.json') {
    try { const p = JSON.parse(code); return (p.name && p.scripts) ? 100 : 50; }
    catch { return 0; }
  }
  if (t === 'requirements.txt') {
    const lines = code.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.length >= 2 ? 100 : lines.length * 50;
  }
  if (t.startsWith('.env')) {
    const vars = code.split('\n').filter(l => /^\w+=/.test(l.trim()));
    return vars.length >= 3 ? 100 : vars.length * 30;
  }
  return 50; // unknown config — partial credit
}

// ── Plan Scoring ────────────────────────────────────────────────────────────

/** Score a plan text against project requirements.
 *  Returns score 0–100. */
export function scorePlan(planText, requirements) {
  if (!planText || planText.length < 50) return 0;
  let score = 0;

  // Structure: has numbered steps or bullet points?
  const steps = (planText.match(/^\s*[\d•\-\*]\s*/gm) || []).length;
  if (steps >= 3) score += 25;
  else if (steps >= 1) score += 10;

  // Coverage: required keywords mentioned in plan?
  const lower = planText.toLowerCase();
  const kwTotal = requirements.mustHaveKeywords?.length || 1;
  let kwHit = 0;
  for (const kw of (requirements.mustHaveKeywords || [])) {
    if (lower.includes(kw.toLowerCase())) kwHit++;
  }
  score += Math.round(25 * (kwHit / kwTotal));

  // File count: plan mentions enough files/modules?
  const fileRefs = (planText.match(/\.\w{1,5}\b/g) || []).length;
  if (fileRefs >= (requirements.minFiles || 3)) score += 20;
  else if (fileRefs >= 1) score += 10;

  // Logical ordering: DB/model before routes/handler?
  const hasStructure = /(?:databáz|model|schéma|db)[\s\S]{0,500}(?:rout|handler|endpoint|api)/i.test(planText);
  if (hasStructure) score += 15;
  else score += 5;

  // Auth/error handling mentioned if required
  if (requirements.authRequired && /(?:auth|jwt|token|heslo|hash)/i.test(planText)) score += 10;
  if (requirements.errorHandling && /(?:error|chyb|catch|handler|valid)/i.test(planText)) score += 5;
  if (!requirements.authRequired) score += 10;
  if (!requirements.errorHandling) score += 5;

  return Math.min(100, score);
}

// ── Code Scoring ────────────────────────────────────────────────────────────

/** Score generated code blocks against requirements.
 *  Returns score 0–100. */
export function scoreCode(codeBlocks, lang, requirements) {
  if (!codeBlocks || codeBlocks.length === 0) return 0;
  let score = 0;

  // File count
  const fileCount = codeBlocks.filter(b => b.lines > 3).length;
  if (fileCount >= (requirements.minFiles || 3)) score += 15;
  else score += Math.round(15 * fileCount / (requirements.minFiles || 3));

  // Syntax check (JS/Python only)
  let syntaxOk = 0;
  let syntaxChecked = 0;
  for (const block of codeBlocks) {
    const effectiveLang = block.lang || lang;
    const result = checkSyntax(block.code, effectiveLang);
    if (result) {
      syntaxChecked++;
      if (result.ok) syntaxOk++;
    }
  }
  if (syntaxChecked > 0) {
    score += Math.round(20 * (syntaxOk / syntaxChecked));
  } else {
    score += 10; // No checker available — partial credit
  }

  // Config / template bonus (by filename extension)
  let configScore = 0;
  let configCount = 0;
  for (const block of codeBlocks) {
    const fn = (block.filename || '').toLowerCase();
    if (fn === 'package.json' || fn === 'requirements.txt' || fn.startsWith('.env')) {
      configCount++;
      configScore += scoreConfigFile(block.code, fn);
    } else if (fn.endsWith('.html') || fn.endsWith('.jinja2') || fn.endsWith('.j2')) {
      configCount++;
      configScore += scoreTemplate(block.code);
    }
  }
  if (configCount > 0) {
    score += Math.round(10 * (configScore / (configCount * 100)));
  }

  // No placeholders
  let placeholderFree = 0;
  for (const block of codeBlocks) {
    if (!hasPlaceholder(block.code)) placeholderFree++;
  }
  score += Math.round(20 * (placeholderFree / Math.max(1, codeBlocks.length)));

  // Keywords present
  const allCode = codeBlocks.map(b => b.code).join('\n').toLowerCase();
  const kwTotal = requirements.mustHaveKeywords?.length || 1;
  let kwHit = 0;
  for (const kw of (requirements.mustHaveKeywords || [])) {
    if (allCode.includes(kw.toLowerCase())) kwHit++;
  }
  score += Math.round(20 * (kwHit / kwTotal));

  // Import consistency (JS only for now)
  const l = (lang || '').toLowerCase();
  if (['javascript', 'js'].includes(l)) {
    const { unresolved } = checkJsImports(codeBlocks);
    if (unresolved.length === 0) score += 15;
    else score += Math.max(0, 15 - unresolved.length * 3);
  } else if (['python', 'py'].includes(l)) {
    const { unresolved } = checkPyImports(codeBlocks);
    if (unresolved.length === 0) score += 15;
    else score += Math.max(0, 15 - unresolved.length * 3);
  } else {
    score += 10; // Go — partial credit
  }

  // Code substantiveness (average lines)
  const avgLines = codeBlocks.reduce((s, b) => s + b.lines, 0) / Math.max(1, codeBlocks.length);
  if (avgLines > 15) score += 10;
  else if (avgLines > 5) score += 5;

  return Math.min(100, score);
}

// ── Alignment Scoring ───────────────────────────────────────────────────────

/** Score code vs. plan alignment.
 *  Returns score 0–100. */
export function scoreAlignment(codeBlocks, planText, requirements) {
  if (!codeBlocks || codeBlocks.length === 0) return 0;
  let score = 0;
  const allCode = codeBlocks.map(b => b.code).join('\n');
  const lower = allCode.toLowerCase();

  // Features from plan implemented in code (keyword cross-check)
  const kwTotal = requirements.mustHaveKeywords?.length || 1;
  let kwHit = 0;
  for (const kw of (requirements.mustHaveKeywords || [])) {
    if (lower.includes(kw.toLowerCase())) kwHit++;
  }
  score += Math.round(30 * (kwHit / kwTotal));

  // Error handling present if required
  if (requirements.errorHandling) {
    const hasErrorHandling = /try\s*[\{:]|except\s+|\.catch\(|catch\s*\(/.test(allCode);
    if (hasErrorHandling) score += 20;
  } else {
    score += 20;
  }

  // Auth present if required
  if (requirements.authRequired) {
    const hasHashing = /hash|bcrypt|crypto|pbkdf|scrypt/i.test(allCode);
    const hasEnvSecret = /process\.env|os\.environ|os\.getenv|env\[/i.test(allCode);
    if (hasHashing) score += 10;
    if (hasEnvSecret) score += 10;
  } else {
    score += 20;
  }

  // No hardcoded secrets
  const hasHardcodedSecret = /(?:secret|password|key)\s*[:=]\s*['"][^'"]{4,}['"]/i.test(allCode)
    && !/process\.env|os\.environ|os\.getenv/i.test(allCode);
  if (!hasHardcodedSecret) score += 15;

  // Route count matches requirement
  if (requirements.minRoutes) {
    const routePatterns = [
      /app\.(get|post|put|delete|patch)\s*\(/gi,
      /router\.(get|post|put|delete|patch)\s*\(/gi,
      /HandleFunc\s*\(/gi,
      /@app\.route/gi,
    ];
    let routeCount = 0;
    for (const re of routePatterns) {
      routeCount += (allCode.match(re) || []).length;
    }
    if (routeCount >= requirements.minRoutes) score += 15;
    else score += Math.round(15 * routeCount / requirements.minRoutes);
  } else {
    score += 15;
  }

  return Math.min(100, score);
}

// ── Test Scoring ────────────────────────────────────────────────────────────

/** Score test code blocks.
 *  Returns score 0–100. */
export function scoreTests(testBlocks, sourceBlocks) {
  if (!testBlocks || testBlocks.length === 0) return 0;
  let score = 0;
  const allTests = testBlocks.map(b => b.code).join('\n');
  const lower = allTests.toLowerCase();

  // Test files exist
  if (testBlocks.length >= 1) score += 15;

  // Has assertions
  const hasAssert = /assert|expect|should|assertEqual|toBe|toEqual|toThrow/i.test(allTests);
  if (hasAssert) score += 15;

  // Has test structure
  const hasStructure = /describe\(|it\(|test\(|def test_|class Test|suite\(/i.test(allTests);
  if (hasStructure) score += 10;

  // Imports from source modules
  const allSource = (sourceBlocks || []).map(b => b.code).join('\n');
  const exportedNames = [];
  for (const m of allSource.matchAll(/export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/g)) {
    exportedNames.push(m[1]);
  }
  for (const m of allSource.matchAll(/def\s+(\w+)/g)) {
    exportedNames.push(m[1]);
  }
  // CommonJS: module.exports = { name1, name2 }
  for (const m of allSource.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g)) {
    for (const exp of m[1].matchAll(/(\w+)\s*(?::|,)/g)) {
      exportedNames.push(exp[1]);
    }
  }
  // CommonJS: module.exports = functionName
  for (const m of allSource.matchAll(/module\.exports\s*=\s*(\w+)/g)) {
    exportedNames.push(m[1]);
  }
  let imported = 0;
  for (const name of exportedNames) {
    if (lower.includes(name.toLowerCase())) imported++;
  }
  if (exportedNames.length > 0) {
    score += Math.round(20 * Math.min(1, imported / exportedNames.length));
  } else {
    score += 10;
  }

  // Coverage: happy path keywords
  const happyPatterns = /\b(success|valid|correct|pass|return|result|expect)\b/i;
  if (happyPatterns.test(allTests)) score += 10;

  // Coverage: edge case keywords
  const edgePatterns = /\b(error|invalid|empty|null|undefined|throw|except|edge|boundary|negative|404|401|0|NaN)\b/i;
  if (edgePatterns.test(allTests)) score += 15;

  // No placeholders in tests
  if (!hasPlaceholder(allTests)) score += 15;

  return Math.min(100, score);
}

// ── Analysis Scoring ────────────────────────────────────────────────────────

/** Score analysis response against ground truth.
 *  Returns { score, found, missed, details }. */
export function scoreAnalysis(responseText, groundTruth) {
  const lower = (responseText || '').toLowerCase();
  let totalWeight = 0;
  let earnedWeight = 0;
  const found = [];
  const missed = [];

  for (const item of groundTruth) {
    totalWeight += item.weight;
    const hit = item.keywords.some(kw => lower.includes(kw.toLowerCase()));
    if (hit) {
      found.push(item.id);
      let itemScore = item.weight;
      // Bonus for explanation (≥30 words around the keyword)
      const hasExplanation = responseText.length > 100;
      if (hasExplanation) itemScore += Math.round(item.weight * 0.3);
      // Bonus for code fix
      const hasCodeBlock = /```[\s\S]*?```/.test(responseText);
      if (hasCodeBlock) itemScore += Math.round(item.weight * 0.2);
      earnedWeight += Math.min(item.weight * 1.5, itemScore);
    } else {
      missed.push(item.id);
    }
  }

  // False positive penalty (very rough — check for clearly phantom findings)
  // Skip for now — too error-prone without LLM grading

  const score = totalWeight > 0 ? Math.round(100 * (earnedWeight / (totalWeight * 1.5))) : 0;
  return { score, found, missed, total: groundTruth.length, details: { earnedWeight, totalWeight } };
}

// ── Debug Scoring ───────────────────────────────────────────────────────────

/** Score debug response against ground truth bugs.
 *  Returns { score, found, missed }. */
export function scoreDebug(responseText, groundTruth) {
  const lower = (responseText || '').toLowerCase();
  let totalWeight = 0;
  let earned = 0;
  const found = [];
  const missed = [];

  for (const item of groundTruth) {
    totalWeight += item.weight;
    const hit = item.keywords.some(kw => lower.includes(kw.toLowerCase()));
    if (hit) {
      found.push(item.id);
      earned += item.weight;
      // Bonus for mechanism explanation
      if (/protože|because|důvod|reason|caus/i.test(responseText)) {
        earned += Math.round(item.weight * 0.4);
      }
      // Bonus for code fix
      if (/```[\s\S]*?```/.test(responseText)) {
        earned += Math.round(item.weight * 0.3);
      }
    } else {
      missed.push(item.id);
    }
  }

  const maxEarnable = totalWeight * 1.7; // root cause + explanation + fix
  const score = maxEarnable > 0 ? Math.round(100 * Math.min(1, earned / maxEarnable)) : 0;
  return { score, found, missed, total: groundTruth.length };
}

// ── Completion Scoring ──────────────────────────────────────────────────────

/** Score project completion (existing code preservation + new features).
 *  Returns { score, preservation, completeness, consistency }. */
export function scoreCompletion(responseText, existingCode, requiredFeatures) {
  const blocks = extractCodeBlocks(responseText);
  if (blocks.length === 0) return { score: 0, preservation: 0, completeness: 0, consistency: 0 };

  const completedCode = blocks.map(b => b.code).join('\n');
  const lower = completedCode.toLowerCase();

  // Preservation: existing code lines still present (fuzzy)
  const existingLines = existingCode.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 10 && !l.startsWith('//') && !l.startsWith('#'));
  let preserved = 0;
  for (const line of existingLines) {
    if (completedCode.includes(line.trim())) preserved++;
  }
  const preservation = existingLines.length > 0
    ? Math.round(100 * (preserved / existingLines.length))
    : 100;

  // Completeness: required features present
  let featuresHit = 0;
  for (const feature of requiredFeatures) {
    const hit = feature.keywords.some(kw => lower.includes(kw.toLowerCase()));
    if (hit) featuresHit++;
  }
  const completeness = requiredFeatures.length > 0
    ? Math.round(100 * (featuresHit / requiredFeatures.length))
    : 100;

  // Consistency: no placeholders, consistent style
  let consistency = 100;
  if (hasPlaceholder(completedCode)) consistency -= 30;
  // Check indent consistency (tabs vs spaces)
  const tabLines = (completedCode.match(/^\t/gm) || []).length;
  const spaceLines = (completedCode.match(/^ {2,}/gm) || []).length;
  if (tabLines > 0 && spaceLines > 0) {
    const ratio = Math.min(tabLines, spaceLines) / Math.max(tabLines, spaceLines);
    if (ratio > 0.3) consistency -= 15; // Mixed indent
  }

  const score = Math.round(preservation * 0.3 + completeness * 0.4 + consistency * 0.3);
  return { score, preservation, completeness, consistency };
}

// ── Test Generation Scoring ─────────────────────────────────────────────────

/** Score test generation for a utility module.
 *  Returns { score, coveredFunctions, edgeCases, details }. */
export function scoreTestGeneration(responseText, functions) {
  const blocks = extractCodeBlocks(responseText);
  if (blocks.length === 0) return { score: 0, coveredFunctions: 0, edgeCases: 0, details: {} };

  const allTests = blocks.map(b => b.code).join('\n');
  const lower = allTests.toLowerCase();
  let score = 0;

  // Function coverage: ≥1 test per function
  let coveredFunctions = 0;
  for (const fn of functions) {
    if (lower.includes(fn.toLowerCase())) coveredFunctions++;
  }
  score += Math.round(50 * (coveredFunctions / Math.max(1, functions.length)));

  // Edge cases per function
  const edgeKeywords = ['null', 'undefined', 'empty', '', '""', "''", '[]', '{}', '0', 'NaN', 'invalid', 'throw', 'error', 'edge', 'negative', 'special'];
  let edgeCases = 0;
  for (const kw of edgeKeywords) {
    if (lower.includes(kw)) edgeCases++;
  }
  score += Math.min(25, edgeCases * 3);

  // Has assertions
  if (/assert|expect|should|toBe|toEqual/i.test(allTests)) score += 10;

  // Imports from utility module
  if (/import|require/i.test(allTests) && functions.some(fn => lower.includes(fn.toLowerCase()))) {
    score += 15;
  }

  return { score: Math.min(100, score), coveredFunctions, edgeCases, details: { totalFunctions: functions.length } };
}

// ── Feedback Generator ──────────────────────────────────────────────────────

/** Generate specific feedback for the weakest phase.
 *  Returns a string with concrete instructions. */
export function generateFeedback(phase, scores, codeBlocks, requirements) {
  const issues = [];

  if (phase === 'plan') {
    if (scores.plan < 40) issues.push('Plán je příliš vágní. Přidej konkrétní kroky a soubory.');
    const lower = (scores._planText || '').toLowerCase();
    for (const kw of (requirements?.mustHaveKeywords || [])) {
      if (!lower.includes(kw.toLowerCase())) issues.push(`Plán nezmiňuje "${kw}" — přidej.`);
    }
    if (requirements?.authRequired && !/auth|jwt|token/i.test(scores._planText || '')) {
      issues.push('Plán neobsahuje autentizaci (JWT/token) — přidej.');
    }
  }

  if (phase === 'code') {
    for (const block of (codeBlocks || [])) {
      if (hasPlaceholder(block.code)) {
        issues.push(`Soubor "${block.filename || 'unnamed'}" obsahuje TODO/placeholder — dokonči implementaci.`);
      }
      const syntax = checkSyntax(block.code, block.lang);
      if (syntax && !syntax.ok) {
        issues.push(`Soubor "${block.filename || 'unnamed'}" má syntax error: ${syntax.error?.substring(0, 100)}`);
      }
    }
    if (codeBlocks && codeBlocks.length < (requirements?.minFiles || 3)) {
      issues.push(`Očekáváno ≥${requirements?.minFiles || 3} souborů, vygenerováno ${codeBlocks.length}.`);
    }
  }

  if (phase === 'alignment') {
    const allCode = (codeBlocks || []).map(b => b.code).join('\n').toLowerCase();
    for (const kw of (requirements?.mustHaveKeywords || [])) {
      if (!allCode.includes(kw.toLowerCase())) {
        issues.push(`Kód neobsahuje "${kw}" — přidej.`);
      }
    }
    if (requirements?.errorHandling && !/try|catch|except/i.test(allCode)) {
      issues.push('Chybí error handling (try/catch) — přidej.');
    }
    if (requirements?.authRequired && !/hash|bcrypt|crypto/i.test(allCode)) {
      issues.push('Chybí hashování hesel — přidej bcrypt/crypto.');
    }
  }

  if (phase === 'test') {
    issues.push('Testy jsou nedostatečné. Přidej testy pro hlavní funkce a edge cases.');
  }

  if (issues.length === 0) issues.push(`Fáze "${phase}" potřebuje zlepšení — zvyš kvalitu.`);
  return `Iterace oprav — ${phase}:\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
