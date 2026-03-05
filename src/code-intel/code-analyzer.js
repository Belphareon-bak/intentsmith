// Deep Code Analyzer v1 — Regex-based structure extraction
// ══════════════════════════════════════════════════════════════════════════════
//
// Extracts code structure, detects code smells, and finds config values.
// Pure regex — no AST, works for any language without external deps.
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── Code Smell Patterns (universal) ─────────────────────────────────────────

const SMELL_PATTERNS = [
  { pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,                  type: 'EMPTY_CATCH',    severity: 'warning' },
  { pattern: /\/\/\s*TODO\b/i,                                    type: 'TODO',           severity: 'info' },
  { pattern: /\/\/\s*FIXME\b/i,                                   type: 'FIXME',          severity: 'warning' },
  { pattern: /\/\/\s*HACK\b/i,                                    type: 'HACK',           severity: 'warning' },
  { pattern: /\/\/\s*XXX\b/i,                                     type: 'XXX',            severity: 'warning' },
  { pattern: /console\.(error|warn)\s*\(/,                         type: 'CONSOLE_ERROR',  severity: 'info' },
  { pattern: /process\.exit\s*\(/,                                 type: 'PROCESS_EXIT',   severity: 'warning' },
  { pattern: /eval\s*\(/,                                          type: 'EVAL_USAGE',     severity: 'error' },
  { pattern: /document\.write\s*\(/,                               type: 'DOC_WRITE',      severity: 'error' },
  { pattern: /innerHTML\s*=/,                                      type: 'INNER_HTML',     severity: 'warning' },
  { pattern: /\bexcept\s*:/,                                       type: 'BARE_EXCEPT',    severity: 'warning' },  // Python
  { pattern: /catch\s*\(\s*Exception\s/,                           type: 'CATCH_ALL',      severity: 'warning' },  // Java
  { pattern: /\bsleep\s*\(\s*\d+\s*\)/,                           type: 'SLEEP_CALL',     severity: 'info' },
  { pattern: /(?:password|secret|api_?key|token)\s*=\s*['"][^'"]+['"]/, type: 'HARDCODED_SECRET', severity: 'error' },
];

// ─── Config Value Patterns ───────────────────────────────────────────────────

const CONFIG_PATTERNS = [
  { pattern: /(?:timeout|TIMEOUT)\s*[:=]\s*(\d+)/,                name: 'timeout' },
  { pattern: /(?:retry|retries|RETRIES|MAX_RETRY)\s*[:=]\s*(\d+)/,name: 'retries' },
  { pattern: /(?:max_?size|MAX_?SIZE|maxSize)\s*[:=]\s*(\d+)/,    name: 'maxSize' },
  { pattern: /(?:pool_?size|POOL_?SIZE|poolSize)\s*[:=]\s*(\d+)/, name: 'poolSize' },
  { pattern: /(?:cache_?ttl|CACHE_?TTL|cacheTTL|cacheTtl)\s*[:=]\s*(\d+)/, name: 'cacheTTL' },
  { pattern: /(?:port|PORT)\s*[:=]\s*(\d+)/,                      name: 'port' },
  { pattern: /(?:limit|LIMIT|max_?limit)\s*[:=]\s*(\d+)/,         name: 'limit' },
  { pattern: /(?:batch_?size|BATCH_?SIZE|batchSize)\s*[:=]\s*(\d+)/, name: 'batchSize' },
  { pattern: /(?:max_?connections|MAX_?CONN)\s*[:=]\s*(\d+)/,     name: 'maxConnections' },
  { pattern: /(?:interval|INTERVAL)\s*[:=]\s*(\d+)/,              name: 'interval' },
];

// ─── Per-language Structure Patterns ─────────────────────────────────────────

const STRUCTURE_PATTERNS = {
  javascript: {
    classes: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g,
    functions: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    arrowFunctions: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(?([^)]*)\)?\s*=>/g,
    constants: /(?:export\s+)?const\s+([A-Z][A-Z_0-9]+)\s*=/g,
    exports: /export\s+(?:default\s+)?(?:class|function|const|let|var|async)\s+(\w+)/g,
  },
  typescript: {
    classes: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g,
    functions: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g,
    arrowFunctions: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*(?:async\s+)?\(?([^)]*)\)?\s*=>/g,
    interfaces: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/g,
    types: /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/g,
    enums: /(?:export\s+)?enum\s+(\w+)/g,
    constants: /(?:export\s+)?const\s+([A-Z][A-Z_0-9]+)\s*(?::\s*\w+\s*)?=/g,
  },
  python: {
    classes: /class\s+(\w+)(?:\(([^)]*)\))?:/g,
    functions: /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/g,
    constants: /^([A-Z][A-Z_0-9]+)\s*=/gm,
    decorators: /@(\w+)(?:\(|$)/gm,
  },
  go: {
    functions: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)/g,
    structs: /type\s+(\w+)\s+struct\s*\{/g,
    interfaces: /type\s+(\w+)\s+interface\s*\{/g,
    constants: /const\s+(\w+)\s*(?:\w+)?\s*=/g,
  },
  java: {
    classes: /(?:public|private|protected)?\s*(?:abstract\s+)?(?:static\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g,
    interfaces: /(?:public\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/g,
    enums: /(?:public\s+)?enum\s+(\w+)/g,
    methods: /(?:public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/g,
    constants: /(?:public|private|protected)?\s*static\s+final\s+\w+\s+([A-Z][A-Z_0-9]+)\s*=/g,
  },
  rust: {
    functions: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g,
    structs: /(?:pub\s+)?struct\s+(\w+)/g,
    enums: /(?:pub\s+)?enum\s+(\w+)/g,
    traits: /(?:pub\s+)?trait\s+(\w+)/g,
    impls: /impl\s+(?:<[^>]+>\s+)?(\w+)/g,
    constants: /(?:pub\s+)?const\s+([A-Z][A-Z_0-9]+)\s*:/g,
  },
  c: {
    functions: /(?:\w+[\s*]+)+(\w+)\s*\(([^)]*)\)\s*\{/g,
    structs: /(?:typedef\s+)?struct\s+(\w+)/g,
    enums: /(?:typedef\s+)?enum\s+(\w+)/g,
    defines: /#define\s+(\w+)/g,
  },
  cpp: {
    classes: /class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+(\w+))?/g,
    functions: /(?:\w+[\s*&]+)+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:override\s*)?(?:=\s*0\s*)?[{;]/g,
    structs: /struct\s+(\w+)/g,
    namespaces: /namespace\s+(\w+)/g,
  },
  php: {
    classes: /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g,
    functions: /(?:public|private|protected|static)?\s*function\s+(\w+)\s*\(([^)]*)\)/g,
    interfaces: /interface\s+(\w+)/g,
    traits: /trait\s+(\w+)/g,
  },
  ruby: {
    classes: /class\s+(\w+)(?:\s*<\s*(\w+))?/g,
    methods: /def\s+(\w+[?!=]?)\s*(?:\(([^)]*)\))?/g,
    modules: /module\s+(\w+)/g,
  },
};

// ─── Language detection helper ───────────────────────────────────────────────

const LANG_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.java': 'java', '.kt': 'java', '.scala': 'java',
  '.rs': 'rust',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
  '.cs': 'java',  // C# is close enough to Java patterns
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'java',  // Swift struct patterns close to Java
};

export function detectLanguage(filePath) {
  if (!filePath) return 'unknown';
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  return LANG_MAP[filePath.substring(dot)] || 'unknown';
}

// ─── Main: Analyze Code Structure ────────────────────────────────────────────

/**
 * Analyze code structure using regex patterns.
 *
 * @param {string} content - File content
 * @param {string} language - Language identifier (javascript, python, go, etc.)
 * @returns {CodeStructure}
 */
export function analyzeCodeStructure(content, language) {
  if (!content) {
    return { classes: [], functions: [], interfaces: [], enums: [], constants: [], exports: [], codeSmells: [], configValues: [] };
  }

  const lines = content.split('\n');
  const result = {
    classes: [],
    functions: [],
    interfaces: [],
    enums: [],
    constants: [],
    exports: [],
    codeSmells: [],
    configValues: [],
  };

  // ─── Structure extraction (language-specific) ─────────────
  const patterns = STRUCTURE_PATTERNS[language];
  if (patterns) {
    // Classes
    if (patterns.classes) {
      for (const m of content.matchAll(patterns.classes)) {
        const line = getLineNumber(content, m.index);
        result.classes.push({
          name: m[1],
          extends: m[2] || null,
          implements: m[3] ? m[3].split(',').map(s => s.trim()) : null,
          line,
        });
      }
    }

    // Functions / methods
    const fnPatterns = ['functions', 'methods', 'arrowFunctions'];
    for (const key of fnPatterns) {
      if (patterns[key]) {
        for (const m of content.matchAll(patterns[key])) {
          const line = getLineNumber(content, m.index);
          const params = m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [];
          result.functions.push({
            name: m[1],
            params,
            line,
            kind: key === 'arrowFunctions' ? 'arrow' : key === 'methods' ? 'method' : 'function',
          });
        }
      }
    }

    // Interfaces
    if (patterns.interfaces) {
      for (const m of content.matchAll(patterns.interfaces)) {
        result.interfaces.push({
          name: m[1],
          extends: m[2] ? m[2].split(',').map(s => s.trim()) : null,
          line: getLineNumber(content, m.index),
        });
      }
    }

    // Enums
    if (patterns.enums) {
      for (const m of content.matchAll(patterns.enums)) {
        result.enums.push({
          name: m[1],
          line: getLineNumber(content, m.index),
        });
      }
    }

    // Structs (Go, Rust, C)
    if (patterns.structs) {
      for (const m of content.matchAll(patterns.structs)) {
        result.classes.push({
          name: m[1],
          extends: null,
          implements: null,
          line: getLineNumber(content, m.index),
          kind: 'struct',
        });
      }
    }

    // Traits (Rust, PHP)
    if (patterns.traits) {
      for (const m of content.matchAll(patterns.traits)) {
        result.interfaces.push({
          name: m[1],
          extends: null,
          line: getLineNumber(content, m.index),
          kind: 'trait',
        });
      }
    }

    // Constants
    if (patterns.constants) {
      for (const m of content.matchAll(patterns.constants)) {
        result.constants.push({
          name: m[1],
          line: getLineNumber(content, m.index),
        });
      }
    }

    // Exports (JS/TS)
    if (patterns.exports) {
      for (const m of content.matchAll(patterns.exports)) {
        result.exports.push({
          name: m[1],
          line: getLineNumber(content, m.index),
        });
      }
    }
  }

  // ─── Code smell detection (universal) ─────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const smell of SMELL_PATTERNS) {
      if (smell.pattern.test(line)) {
        result.codeSmells.push({
          type: smell.type,
          severity: smell.severity,
          line: i + 1,
          content: line.trim().substring(0, 100),
        });
      }
    }
  }

  // ─── Config value detection (universal) ────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const cfg of CONFIG_PATTERNS) {
      const m = cfg.pattern.exec(line);
      if (m) {
        result.configValues.push({
          name: cfg.name,
          value: m[1],
          line: i + 1,
          raw: line.trim().substring(0, 100),
        });
      }
    }
  }

  return result;
}

// ─── Summary Builder ─────────────────────────────────────────────────────────

/**
 * Build a concise summary string from analysis results.
 *
 * @param {CodeStructure} analysis
 * @returns {string}
 */
export function buildAnalysisSummary(analysis) {
  const parts = [];

  if (analysis.classes.length > 0) {
    const kinds = analysis.classes.some(c => c.kind === 'struct') ? 'Structs' : 'Classes';
    parts.push(`**${kinds}:** ${analysis.classes.map(c => c.name).join(', ')}`);
  }

  if (analysis.functions.length > 0) {
    const count = analysis.functions.length;
    const names = analysis.functions.slice(0, 5).map(f => f.name).join(', ');
    const suffix = count > 5 ? ` (+${count - 5} more)` : '';
    parts.push(`**Functions:** ${names}${suffix}`);
  }

  if (analysis.interfaces.length > 0) {
    parts.push(`**Interfaces:** ${analysis.interfaces.map(i => i.name).join(', ')}`);
  }

  if (analysis.enums.length > 0) {
    parts.push(`**Enums:** ${analysis.enums.map(e => e.name).join(', ')}`);
  }

  if (analysis.constants.length > 0) {
    const count = analysis.constants.length;
    const names = analysis.constants.slice(0, 5).map(c => c.name).join(', ');
    const suffix = count > 5 ? ` (+${count - 5} more)` : '';
    parts.push(`**Constants:** ${names}${suffix}`);
  }

  if (analysis.codeSmells.length > 0) {
    const bySeverity = {};
    for (const s of analysis.codeSmells) {
      bySeverity[s.severity] = (bySeverity[s.severity] || 0) + 1;
    }
    const smellStr = Object.entries(bySeverity)
      .map(([sev, count]) => `${count} ${sev}`)
      .join(', ');
    parts.push(`**Code Smells:** ${smellStr}`);
  }

  if (analysis.configValues.length > 0) {
    const cfgStr = analysis.configValues
      .slice(0, 5)
      .map(c => `${c.name}=${c.value}`)
      .join(', ');
    parts.push(`**Config Values:** ${cfgStr}`);
  }

  return parts.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

export default { analyzeCodeStructure, buildAnalysisSummary, detectLanguage };
