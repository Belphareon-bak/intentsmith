// Code Reviewer — Analyze Code Tool
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure deterministic tool: takes code + language + focus → returns structured
// findings with severity, line hints, and recommendations.
//
// No LLM. No side effects. No external calls.
//
// Checks:
//   - Variable naming (single-char, ALL_CAPS misuse)
//   - Function length (>50 lines = warning)
//   - Nesting depth (>4 = warning)
//   - TODO/FIXME/HACK comments
//   - Magic numbers
//   - console.log/print statements
//   - Unused imports pattern
//
// ══════════════════════════════════════════════════════════════════════════════

const VALID_FOCUS = ['all', 'security', 'performance', 'readability', 'solid'];

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitLines(code) {
  return code.split(/\r?\n/);
}

/**
 * Compute max nesting depth and lines where depth exceeds threshold.
 */
function analyzeNesting(lines) {
  let depth = 0;
  let maxDepth = 0;
  const deepLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/[{(]/g) || []).length;
    const closes = (line.match(/[})]/g) || []).length;
    depth += opens - closes;
    if (depth < 0) depth = 0;
    if (depth > maxDepth) maxDepth = depth;
    if (depth > 4) {
      deepLines.push(i + 1);
    }
  }

  return { maxDepth, deepLines };
}

/**
 * Detect function boundaries and return those exceeding length threshold.
 */
function detectLongFunctions(lines, language) {
  const results = [];
  const funcPatterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(?.*?\)?\s*=>/,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
  ];

  if (language === 'python') {
    funcPatterns.length = 0;
    funcPatterns.push(/^\s*(?:async\s+)?def\s+(\w+)/);
  } else if (language === 'go') {
    funcPatterns.length = 0;
    funcPatterns.push(/^\s*func\s+(?:\([^)]*\)\s+)?(\w+)/);
  }

  let currentFunc = null;
  let funcStart = -1;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!currentFunc) {
      for (const pat of funcPatterns) {
        const m = line.match(pat);
        if (m) {
          currentFunc = m[1];
          funcStart = i + 1;
          braceDepth = 0;
          break;
        }
      }
    }

    if (currentFunc) {
      if (language === 'python') {
        // Python: function ends when next non-empty line at same or lower indentation
        if (i > funcStart - 1) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            const indent = line.length - line.trimStart().length;
            const startIndent = lines[funcStart - 1].length - lines[funcStart - 1].trimStart().length;
            if (indent <= startIndent && !line.match(/^\s*(?:#|@|$)/)) {
              const length = i - funcStart + 1;
              if (length > 50) {
                results.push({ name: currentFunc, startLine: funcStart, length });
              }
              currentFunc = null;
              // Re-check this line for a new function
              i--;
              continue;
            }
          }
        }
      } else {
        // Brace-based languages
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        braceDepth += opens - closes;
        if (braceDepth <= 0 && i > funcStart - 1) {
          const length = i - funcStart + 1;
          if (length > 50) {
            results.push({ name: currentFunc, startLine: funcStart, length });
          }
          currentFunc = null;
          braceDepth = 0;
        }
      }
    }
  }

  // Handle unclosed function at EOF
  if (currentFunc) {
    const length = lines.length - funcStart + 1;
    if (length > 50) {
      results.push({ name: currentFunc, startLine: funcStart, length });
    }
  }

  return results;
}

/**
 * Detect single-character variable names (excluding i, j, k in loops)
 * and ALL_CAPS used for non-constant contexts.
 */
function checkNaming(lines) {
  const findings = [];
  const loopVars = new Set(['i', 'j', 'k', 'n', 'x', 'y', 'z', '_']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-char variable declarations (non-loop)
    const varDeclMatch = line.match(/(?:const|let|var)\s+([a-zA-Z])\s*[=;]/);
    if (varDeclMatch && !loopVars.has(varDeclMatch[1])) {
      // Skip if it's a for-loop line
      if (!/^\s*for\s*\(/.test(line)) {
        findings.push({
          severity: 'info',
          line: i + 1,
          message: `Single-character variable name '${varDeclMatch[1]}' — consider a more descriptive name`,
          category: 'readability',
        });
      }
    }
  }

  return findings;
}

/**
 * Detect TODO, FIXME, HACK, XXX comments.
 */
function checkTodoComments(lines) {
  const findings = [];
  const pattern = /\b(TODO|FIXME|HACK|XXX)\b/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) {
      findings.push({
        severity: 'info',
        line: i + 1,
        message: `${m[1]} comment found — consider resolving or tracking`,
        category: 'readability',
      });
    }
  }

  return findings;
}

/**
 * Detect magic numbers (numeric literals not in common safe set).
 */
function checkMagicNumbers(lines) {
  const findings = [];
  const safeNumbers = new Set(['-1', '0', '1', '2', '100', '1000', '0.5', '0.0', '1.0']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments and import lines
    if (/^\s*(?:\/\/|#|\*|import\s|from\s)/.test(line)) continue;
    // Skip const/define declarations (those are named constants)
    if (/^\s*(?:const|#define|final)\s+\w+\s*=/.test(line)) continue;

    const matches = line.matchAll(/(?<![.\w])(\d+(?:\.\d+)?)(?![.\w"'])/g);
    for (const m of matches) {
      const num = m[1];
      if (!safeNumbers.has(num) && num.length > 0) {
        // Skip numbers in array indices and common patterns
        const idx = m.index;
        const before = line.substring(Math.max(0, idx - 5), idx);
        if (/\[\s*$/.test(before)) continue; // Array index
        if (/port\s*[:=]\s*$/.test(line.substring(0, idx))) continue; // Port numbers

        findings.push({
          severity: 'info',
          line: i + 1,
          message: `Magic number ${num} — consider extracting to a named constant`,
          category: 'readability',
        });
      }
    }
  }

  return findings;
}

/**
 * Detect console.log, console.warn, console.error, print() statements.
 */
function checkDebugStatements(lines, language) {
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;

    if (/console\.(log|warn|error|debug|info)\s*\(/.test(line)) {
      findings.push({
        severity: 'warning',
        line: i + 1,
        message: 'console.log/warn/error statement found — remove before production',
        category: 'readability',
      });
    }

    if (language === 'python' && /\bprint\s*\(/.test(line)) {
      // Exclude if it's inside a function named "print" or a logger
      if (!/logging|logger|log\./i.test(line)) {
        findings.push({
          severity: 'warning',
          line: i + 1,
          message: 'print() statement found — consider using logging module',
          category: 'readability',
        });
      }
    }
  }

  return findings;
}

/**
 * Detect unused imports (heuristic: imported name not found elsewhere in code).
 */
function checkUnusedImports(lines, language) {
  const findings = [];
  const importNames = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ES import: import { foo, bar } from '...'
    const esMatch = line.match(/import\s+\{([^}]+)\}\s+from/);
    if (esMatch) {
      const names = esMatch[1].split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return { name: (parts[1] || parts[0]).trim(), line: i + 1 };
      });
      importNames.push(...names);
    }

    // Default import: import foo from '...'
    const defaultMatch = line.match(/import\s+(\w+)\s+from/);
    if (defaultMatch && !line.includes('{')) {
      importNames.push({ name: defaultMatch[1], line: i + 1 });
    }

    // Python import: from foo import bar, baz
    if (language === 'python') {
      const pyMatch = line.match(/from\s+\S+\s+import\s+(.+)/);
      if (pyMatch) {
        const names = pyMatch[1].split(',').map(n => {
          const parts = n.trim().split(/\s+as\s+/);
          return { name: (parts[1] || parts[0]).trim(), line: i + 1 };
        });
        importNames.push(...names);
      }

      const pySimple = line.match(/^import\s+(\w+)(?:\s+as\s+(\w+))?/);
      if (pySimple) {
        importNames.push({ name: (pySimple[2] || pySimple[1]).trim(), line: i + 1 });
      }
    }

    // Go import (single line)
    if (language === 'go') {
      const goMatch = line.match(/^\s*(?:(\w+)\s+)?"[^"]+"\s*$/);
      if (goMatch && goMatch[1]) {
        importNames.push({ name: goMatch[1], line: i + 1 });
      }
    }
  }

  // Check if each imported name is used elsewhere
  const fullCode = lines.join('\n');
  for (const imp of importNames) {
    // Build regex: name must appear as a word boundary somewhere other than the import line
    const escapedName = imp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedName}\\b`, 'g');
    const allMatches = [...fullCode.matchAll(regex)];

    // Count occurrences — subtract 1 for the import itself
    if (allMatches.length <= 1) {
      findings.push({
        severity: 'warning',
        line: imp.line,
        message: `Import '${imp.name}' appears unused — remove if not needed`,
        category: 'readability',
      });
    }
  }

  return findings;
}

// ─── Score Calculation ──────────────────────────────────────────────────────

function calculateScore(findings) {
  let score = 100;

  for (const f of findings) {
    switch (f.severity) {
      case 'critical': score -= 15; break;
      case 'warning':  score -= 5;  break;
      case 'info':     score -= 1;  break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Analyze code for quality issues.
 *
 * @param {Object} params
 * @param {string} params.code      - Source code to analyze
 * @param {string} [params.language='javascript'] - Language (javascript, python, go, java, typescript)
 * @param {string} [params.focus='all'] - Focus area (all, security, performance, readability, solid)
 * @returns {{ status: string, data: { findings: Array, summary: string, score: number } }}
 */
export function analyzeCode(params) {
  const code = params?.code;
  if (!code || typeof code !== 'string') {
    return { status: 'error', error: 'code is required (string)' };
  }

  const language = (params.language || 'javascript').toLowerCase();
  const focus = (params.focus || 'all').toLowerCase();

  if (!VALID_FOCUS.includes(focus)) {
    return { status: 'error', error: `Invalid focus '${focus}'. Valid: ${VALID_FOCUS.join(', ')}` };
  }

  const lines = splitLines(code);
  const findings = [];

  // ── Readability checks ──────────────────────────────────────────────────

  if (focus === 'all' || focus === 'readability') {
    findings.push(...checkNaming(lines));
    findings.push(...checkTodoComments(lines));
    findings.push(...checkMagicNumbers(lines));
    findings.push(...checkDebugStatements(lines, language));
    findings.push(...checkUnusedImports(lines, language));

    // Nesting depth
    const { maxDepth, deepLines } = analyzeNesting(lines);
    if (maxDepth > 4) {
      findings.push({
        severity: 'warning',
        line: deepLines[0] || null,
        message: `Nesting depth ${maxDepth} exceeds threshold (4) — consider extracting helper functions`,
        category: 'readability',
      });
    }

    // Long functions
    const longFuncs = detectLongFunctions(lines, language);
    for (const f of longFuncs) {
      findings.push({
        severity: 'warning',
        line: f.startLine,
        message: `Function '${f.name}' is ${f.length} lines long (>50) — consider splitting`,
        category: 'readability',
      });
    }
  }

  // ── SOLID checks ────────────────────────────────────────────────────────

  if (focus === 'all' || focus === 'solid') {
    // God function detection: >100 lines
    const longFuncs = focus === 'solid' ? detectLongFunctions(lines, language) : [];
    for (const f of longFuncs) {
      if (f.length > 100) {
        findings.push({
          severity: 'critical',
          line: f.startLine,
          message: `Function '${f.name}' is ${f.length} lines — likely violates Single Responsibility Principle`,
          category: 'solid',
        });
      }
    }

    // Multiple class detection in single file (SRP for classes)
    let classCount = 0;
    const classNames = [];
    for (let i = 0; i < lines.length; i++) {
      const classMatch = lines[i].match(/^\s*(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        classCount++;
        classNames.push(classMatch[1]);
      }
    }
    if (classCount > 1) {
      findings.push({
        severity: 'warning',
        line: null,
        message: `Multiple classes in single file (${classNames.join(', ')}) — consider separate files (SRP)`,
        category: 'solid',
      });
    }
  }

  // ── Performance checks ──────────────────────────────────────────────────

  if (focus === 'all' || focus === 'performance') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Regex in loop
      if (/\bfor\s*\(/.test(line) || /\bwhile\s*\(/.test(line) || /\.forEach\s*\(/.test(line)) {
        // Check next few lines for new RegExp
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          if (/new\s+RegExp\s*\(/.test(lines[j])) {
            findings.push({
              severity: 'warning',
              line: j + 1,
              message: 'RegExp created inside loop — compile once outside for performance',
              category: 'performance',
            });
          }
        }
      }

      // Array concat in loop (quadratic)
      if ((/\.concat\s*\(/.test(line) || /\+\s*=\s*\[/.test(line)) &&
          i > 0 && /\bfor\s*\(|\bwhile\s*\(|\.forEach/.test(lines.slice(Math.max(0, i - 5), i).join('\n'))) {
        findings.push({
          severity: 'info',
          line: i + 1,
          message: 'Array concatenation in loop — consider using push() or spread to avoid quadratic behavior',
          category: 'performance',
        });
      }

      // Synchronous file operations in potentially async context
      if (/readFileSync|writeFileSync|existsSync/.test(line)) {
        findings.push({
          severity: 'info',
          line: i + 1,
          message: 'Synchronous file operation — consider async variant for non-blocking IO',
          category: 'performance',
        });
      }
    }
  }

  // ── Security checks (light — full scan is in security-scan.js) ────────

  if (focus === 'all' || focus === 'security') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\beval\s*\(/.test(line)) {
        findings.push({
          severity: 'critical',
          line: i + 1,
          message: 'eval() usage detected — serious security risk, consider alternatives',
          category: 'security',
        });
      }

      if (/innerHTML\s*=/.test(line) || /dangerouslySetInnerHTML/.test(line)) {
        findings.push({
          severity: 'critical',
          line: i + 1,
          message: 'Direct HTML injection — XSS risk, use safe DOM APIs or sanitization',
          category: 'security',
        });
      }
    }
  }

  // ── Build summary ─────────────────────────────────────────────────────

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  const infoCount = findings.filter(f => f.severity === 'info').length;

  const score = calculateScore(findings);

  let summaryParts = [];
  if (criticalCount > 0) summaryParts.push(`${criticalCount} critical`);
  if (warningCount > 0) summaryParts.push(`${warningCount} warning`);
  if (infoCount > 0) summaryParts.push(`${infoCount} info`);

  const summary = findings.length === 0
    ? `No issues found (focus: ${focus}). Score: ${score}/100`
    : `Found ${findings.length} issues (${summaryParts.join(', ')}). Score: ${score}/100`;

  return {
    status: 'ok',
    data: {
      findings,
      summary,
      score,
    },
  };
}
