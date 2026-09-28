// Performance Analyzer v113 (F12) — Code Performance Anti-Pattern Detection
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects common performance anti-patterns in generated code:
//   - N+1 queries: DB call inside loop body
//   - Unbounded loops: while/for without break/limit
//   - Sync-in-async: synchronous I/O in async function
//   - Redundant queries: same DB call repeated in scope
//   - Large payloads: unbounded SELECT * or array accumulation
//
// Import-aware: DB detection uses import analysis, not just call name regex.
// Advisory only — does NOT block milestones.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Anti-Pattern Types ─────────────────────────────────────────────────────

export const AntiPatternType = Object.freeze({
  N_PLUS_ONE:      'n_plus_one',
  UNBOUNDED_LOOP:  'unbounded_loop',
  SYNC_IN_ASYNC:   'sync_in_async',
  REDUNDANT_QUERY: 'redundant_query',
  LARGE_PAYLOAD:   'large_payload',
});

// ─── DB Import Detection ────────────────────────────────────────────────────

const DB_PACKAGES = new Set([
  'prisma', '@prisma/client', 'knex', 'mongoose', 'sequelize', 'typeorm',
  'drizzle-orm', 'pg', 'mysql2', 'better-sqlite3', 'mongodb', 'redis',
  'sqlalchemy', 'django.db', 'peewee', 'tortoise',
  'gorm', 'database/sql',
]);

const DB_CALL_PATTERNS = [
  /\.(find|findOne|findMany|findAll|findById|findUnique)\s*\(/,
  /\.(select|insert|update|delete|query|execute|exec)\s*\(/,
  /\.(save|create|remove|destroy|count|aggregate)\s*\(/,
  /\.(where|from|join|raw)\s*\(/,
  /\.(get|put|set|scan|batch)\s*\(/,
  /\.(?:fetchone|fetchall|fetchmany|cursor|execute)\s*\(/,
  /db\.\w+\.\w+\s*\(/,
  /prisma\.\w+\.\w+\s*\(/,
  /SELECT\s/i,
  /INSERT\s/i,
  /UPDATE\s.*SET\s/i,
  /DELETE\s.*FROM\s/i,
];

const SYNC_IO_CALLS = [
  'readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync',
  'readdirSync', 'statSync', 'existsSync', 'unlinkSync', 'renameSync',
  'copyFileSync', 'accessSync', 'chmodSync', 'chownSync',
  'execSync', 'spawnSync', 'execFileSync',
];

// ─── Import Extraction ──────────────────────────────────────────────────────

/**
 * Extract import/require package names from source.
 * @param {string} content - Source code
 * @returns {Set<string>} Package names
 */
function _extractImports(content) {
  const imports = new Set();
  if (!content) return imports;

  // ESM: import ... from 'pkg'
  const esmMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
  for (const m of esmMatches) imports.add(m[1]);

  // CJS: require('pkg')
  const cjsMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of cjsMatches) imports.add(m[1]);

  // Python: import pkg / from pkg import
  const pyMatches = content.matchAll(/(?:^|\n)\s*(?:import|from)\s+(\S+)/g);
  for (const m of pyMatches) imports.add(m[1]);

  // Go: import "pkg"
  const goMatches = content.matchAll(/import\s+(?:\([\s\S]*?\)|"([^"]+)")/g);
  for (const m of goMatches) if (m[1]) imports.add(m[1]);

  return imports;
}

/**
 * Check if any imports match known DB packages.
 */
function _hasDBImport(imports) {
  for (const imp of imports) {
    for (const dbPkg of DB_PACKAGES) {
      if (imp === dbPkg || imp.startsWith(dbPkg + '/') || imp.includes(dbPkg)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a line contains a DB-related call.
 */
function _isDBCall(line) {
  for (const pat of DB_CALL_PATTERNS) {
    if (pat.test(line)) return true;
  }
  return false;
}

// ─── Pattern Detectors ──────────────────────────────────────────────────────

/**
 * Detect N+1 query pattern: DB call inside a loop body.
 * Requires DB import evidence.
 */
function _detectNPlusOne(lines, hasDB) {
  if (!hasDB) return [];
  const results = [];

  let inLoop = false;
  let loopStart = -1;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect loop start
    if (/(?:^|\s)(?:for\s*\(|for\s+\w+|while\s*\()/.test(line) ||
        /\.(?:forEach|map|filter|reduce)\s*\(/.test(line) ||
        /^\s*for\s+\w+.*(?:in|of)\s/.test(line)) {
      inLoop = true;
      loopStart = i;
      braceDepth = 0;
    }

    // Track brace depth inside loop
    if (inLoop) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;

      // DB call inside loop
      if (i > loopStart && _isDBCall(trimmed)) {
        results.push({
          type: AntiPatternType.N_PLUS_ONE,
          line: i + 1,
          severity: 'warning',
          description: `Potential N+1 query: DB call inside loop (started line ${loopStart + 1})`,
          suggestion: 'Batch the query before the loop, or use a single query with WHERE IN.',
        });
      }

      // Loop ended
      if (braceDepth <= 0 && i > loopStart) {
        inLoop = false;
      }
    }
  }

  return results;
}

/**
 * Detect unbounded loops: while(true), for(;;), etc. without break/return/limit.
 */
function _detectUnboundedLoops(lines) {
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // while (true) / while True / for (;;)
    const isUnbounded = /while\s*\(\s*true\s*\)/.test(trimmed) ||
      /while\s+True\s*:/.test(trimmed) ||
      /for\s*\(\s*;\s*;\s*\)/.test(trimmed) ||
      /loop\s*\{/.test(trimmed);  // Rust loop

    if (!isUnbounded) continue;

    // Scan forward for break/return within reasonable scope (next 30 lines)
    let hasBreak = false;
    const scanEnd = Math.min(lines.length, i + 30);
    for (let j = i + 1; j < scanEnd; j++) {
      const inner = lines[j].trim();
      if (/\b(?:break|return)\b/.test(inner)) {
        hasBreak = true;
        break;
      }
      // Hit another function/class definition → stop scanning
      if (/^(?:function|class|def|func)\b/.test(inner)) break;
    }

    if (!hasBreak) {
      results.push({
        type: AntiPatternType.UNBOUNDED_LOOP,
        line: i + 1,
        severity: 'warning',
        description: 'Unbounded loop without visible break/return condition',
        suggestion: 'Add a break condition, iteration limit, or timeout to prevent infinite loops.',
      });
    }
  }

  return results;
}

/**
 * Detect synchronous I/O calls inside async functions.
 */
function _detectSyncInAsync(lines) {
  const results = [];

  let inAsync = false;
  let asyncStart = -1;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect async function start
    if (/\basync\s+(?:function|def)\b/.test(line) || /\basync\s/.test(line) && line.includes('=>')) {
      inAsync = true;
      asyncStart = i;
      braceDepth = 0;
    }

    if (inAsync) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;

      // Check for sync I/O calls
      for (const syncCall of SYNC_IO_CALLS) {
        if (line.includes(syncCall)) {
          results.push({
            type: AntiPatternType.SYNC_IN_ASYNC,
            line: i + 1,
            severity: 'warning',
            description: `Synchronous I/O call '${syncCall}' inside async function (line ${asyncStart + 1})`,
            suggestion: `Replace with async equivalent (e.g., '${syncCall.replace('Sync', '')}' from 'fs/promises').`,
          });
        }
      }

      // Function ended
      if (braceDepth <= 0 && i > asyncStart && opens + closes > 0) {
        inAsync = false;
      }
    }
  }

  return results;
}

/**
 * Detect redundant queries: same DB call pattern appearing 2+ times in the same scope.
 */
function _detectRedundantQueries(lines, hasDB) {
  if (!hasDB) return [];
  const results = [];

  // Simple: look for identical DB call portions within 50 lines
  const callLines = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (_isDBCall(trimmed)) {
      // Extract just the DB call portion for comparison
      const callKey = _extractDBCallKey(trimmed);
      callLines.push({ line: i, text: callKey || trimmed });
    }
  }

  const seen = new Map(); // callKey → first line
  for (const { line, text } of callLines) {
    const key = text.replace(/\s+/g, ' ');
    if (seen.has(key)) {
      const firstLine = seen.get(key);
      if (line - firstLine < 50) {
        results.push({
          type: AntiPatternType.REDUNDANT_QUERY,
          line: line + 1,
          severity: 'info',
          description: `Redundant DB call — same query appeared at line ${firstLine + 1}`,
          suggestion: 'Cache the result or extract to a shared variable.',
        });
      }
    } else {
      seen.set(key, line);
    }
  }

  return results;
}

/**
 * Detect large payload patterns: SELECT *, unbounded .push() in loops.
 */
function _detectLargePayload(lines, hasDB) {
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // SELECT * without LIMIT
    if (hasDB && /SELECT\s+\*\s+FROM/i.test(trimmed) && !/LIMIT\s/i.test(trimmed)) {
      results.push({
        type: AntiPatternType.LARGE_PAYLOAD,
        line: i + 1,
        severity: 'info',
        description: 'SELECT * without LIMIT — may return unbounded result set',
        suggestion: 'Add LIMIT clause or select specific columns.',
      });
    }

    // findMany/findAll without take/limit
    if (hasDB && /\.(?:findMany|findAll)\s*\(\s*\)/.test(trimmed)) {
      results.push({
        type: AntiPatternType.LARGE_PAYLOAD,
        line: i + 1,
        severity: 'info',
        description: 'findMany/findAll without pagination — may return unbounded results',
        suggestion: 'Add take/limit/pagination parameters.',
      });
    }
  }

  return results;
}

/**
 * Extract the DB call portion from a line for redundancy comparison.
 * E.g., "const x = await db.query('SELECT * FROM users');" → "db.query('SELECT * FROM users')"
 */
function _extractDBCallKey(line) {
  // Match: something.method(args)
  const m = line.match(/(\w+\.\w+\([^)]*\))/);
  return m ? m[1] : null;
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Detect performance anti-patterns in source code.
 *
 * @param {string} content - Source code
 * @param {string} [language] - Language hint (unused currently — patterns are language-agnostic)
 * @returns {Array<{ type: string, line: number, severity: string, description: string, suggestion: string }>}
 */
export function detectAntiPatterns(content, language) {
  if (!content || typeof content !== 'string') return [];

  const lines = content.split('\n');
  const imports = _extractImports(content);
  const hasDB = _hasDBImport(imports);

  const results = [];
  results.push(..._detectNPlusOne(lines, hasDB));
  results.push(..._detectUnboundedLoops(lines));
  results.push(..._detectSyncInAsync(lines));
  results.push(..._detectRedundantQueries(lines, hasDB));
  results.push(..._detectLargePayload(lines, hasDB));

  // Sort by line number
  results.sort((a, b) => a.line - b.line);

  return results;
}

/**
 * Analyze a file for performance anti-patterns.
 * Convenience wrapper: reads content + runs detection.
 *
 * @param {string} filePath - File path (for reporting)
 * @param {string} content - File content
 * @param {string} [language] - Language hint
 * @returns {Array} Anti-patterns with file path populated
 */
export function analyzeFilePerformance(filePath, content, language) {
  if (!content) return [];

  const patterns = detectAntiPatterns(content, language);
  return patterns.map(p => ({ ...p, file: filePath }));
}

/**
 * Format anti-patterns as a human-readable report.
 *
 * @param {Array} antiPatterns - From detectAntiPatterns or analyzeFilePerformance
 * @param {number} [maxEntries=10] - Maximum entries to include
 * @returns {string}
 */
export function formatPerfReport(antiPatterns, maxEntries = 10) {
  if (!antiPatterns || antiPatterns.length === 0) return '';

  const capped = antiPatterns.slice(0, maxEntries);
  const lines = capped.map(p => {
    const loc = p.file ? `${p.file}:${p.line}` : `line ${p.line}`;
    return `- [${p.severity.toUpperCase()}] ${p.type} at ${loc}: ${p.description}`;
  });

  if (antiPatterns.length > maxEntries) {
    lines.push(`_(${antiPatterns.length - maxEntries} more pattern(s) omitted)_`);
  }

  return lines.join('\n');
}

/**
 * Compute an overall performance severity score (0-100, 100 = clean).
 *
 * @param {Array} antiPatterns
 * @returns {number}
 */
export function severityScore(antiPatterns) {
  if (!antiPatterns || antiPatterns.length === 0) return 100;

  const weights = { warning: 15, info: 5, error: 25 };
  let deductions = 0;
  for (const p of antiPatterns) {
    deductions += weights[p.severity] ?? 10;
  }

  return Math.max(0, 100 - deductions);
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  AntiPatternType,
  detectAntiPatterns,
  analyzeFilePerformance,
  formatPerfReport,
  severityScore,
};
