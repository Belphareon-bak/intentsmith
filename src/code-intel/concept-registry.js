// Concept Registry v102b — Semantic Concept Detection & Fragmentation Analysis
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects high-level functional concepts (authentication, database, logging…)
// across the codebase by analyzing file paths, symbol names, and content.
//
// Key capabilities:
//   - Concept detection: file → concept(s) mapping via multi-signal scoring
//   - Fragmentation analysis: spread of a concept across modules
//   - Drift detection: compare two snapshots to find concept migration
//   - Prompt enrichment: markdown summary for architecture guardian
//
// Pure code-intel module — no DB dependency, works from file arrays or graph.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Concept Signatures ────────────────────────────────────────────────────

/**
 * Each concept has detection signals:
 *   pathPatterns  — regex matched against file paths
 *   symbolPatterns — regex matched against symbol/export names
 *   contentPatterns — regex matched against file content
 *   importPatterns  — regex matched against imported module names
 *
 * A file belongs to a concept if it matches ANY path/symbol pattern
 * OR at least 2 content/import patterns (to avoid false positives).
 */
export const CONCEPT_SIGNATURES = [
  {
    name: 'authentication',
    pathPatterns:    [/(?:^|[/\\])auth(?:entication)?[/\\]/i, /login|signin|sign-in/i],
    symbolPatterns:  [/\b(?:authenticate|login|signIn|verifyToken|validateToken|hashPassword|comparePassword)\b/],
    contentPatterns: [/\bjwt\b|\bjsonwebtoken\b/i, /\bbcrypt\b|\bargon2\b/i, /\bpassport\b/i, /session\.(?:create|destroy|regenerate)/i],
    importPatterns:  [/\bjsonwebtoken\b/, /\bbcrypt\b/, /\bpassport\b/, /\bargon2\b/],
  },
  {
    name: 'authorization',
    pathPatterns:    [/(?:^|[/\\])(?:authz|permissions?|roles?|policies|guards?)[/\\]/i],
    symbolPatterns:  [/\b(?:authorize|checkPermission|hasRole|isAdmin|canAccess|requireRole|guardRoute)\b/],
    contentPatterns: [/\brole\b.*\b(?:admin|user|editor|viewer)\b/i, /\bpermission\b/i, /\baccess.?control\b/i],
    importPatterns:  [/\bcasl\b/, /\baccess-control\b/],
  },
  {
    name: 'database',
    pathPatterns:    [/(?:^|[/\\])(?:db|database|repositories?|dao|data|models?|entities?|migrations?)[/\\]/i],
    symbolPatterns:  [/\b(?:query|findById|findAll|insertOne|updateMany|deleteOne|createTable|migrate|schema)\b/],
    contentPatterns: [/\bSELECT\s+\w+\s+FROM\b/i, /\bCREATE\s+TABLE\b/i, /\.query\s*\(/, /\bmongoose\b|\bsequelize\b|\bprisma\b/i],
    importPatterns:  [/\bbetter-sqlite3\b/, /\bmysql2?\b/, /\bpg\b/, /\bmongoose\b/, /\bsequelize\b/, /\bprisma\b/, /\btypeorm\b/, /\bknex\b/],
  },
  {
    name: 'caching',
    pathPatterns:    [/(?:^|[/\\])cache[/\\]/i],
    symbolPatterns:  [/\b(?:cacheGet|cacheSet|invalidateCache|clearCache|memoize|getCached)\b/],
    contentPatterns: [/\bredis\b/i, /\bmemcached\b/i, /\.setex\(/, /cache\.(?:get|set|del)\b/],
    importPatterns:  [/\bioredis\b/, /\bredis\b/, /\bnode-cache\b/, /\blru-cache\b/],
  },
  {
    name: 'logging',
    pathPatterns:    [/(?:^|[/\\])(?:log(?:ger|ging)?|telemetry|observability)[/\\]/i],
    symbolPatterns:  [/\b(?:logger|log(?:Info|Warn|Error|Debug)|createLogger|initLogging)\b/],
    contentPatterns: [/\bwinston\b/i, /\bpino\b/i, /\bbunyan\b/i, /console\.(?:log|warn|error|info|debug)\b/],
    importPatterns:  [/\bwinston\b/, /\bpino\b/, /\bbunyan\b/, /\blog4js\b/],
  },
  {
    name: 'validation',
    pathPatterns:    [/(?:^|[/\\])(?:validat(?:ion|ors?)|schemas?)[/\\]/i],
    symbolPatterns:  [/\b(?:validate|sanitize|parseSchema|checkInput|isValid)\b/],
    contentPatterns: [/\bzod\b|\bjoi\b|\byup\b|\bajv\b/i, /\.validate\s*\(/, /\.parse\s*\(/],
    importPatterns:  [/\bzod\b/, /\bjoi\b/, /\byup\b/, /\bajv\b/, /\bclass-validator\b/],
  },
  {
    name: 'routing',
    pathPatterns:    [/(?:^|[/\\])(?:routes?|router|endpoints?|api)[/\\]/i],
    symbolPatterns:  [/\b(?:router|setupRoutes|registerEndpoint|createRouter)\b/],
    contentPatterns: [/\brouter\.(get|post|put|delete|patch)\s*\(/i, /app\.(get|post|put|delete)\s*\(['"]/],
    importPatterns:  [/\bexpress\b/, /\bfastify\b/, /\bkoa-router\b/],
  },
  {
    name: 'error-handling',
    pathPatterns:    [/(?:^|[/\\])(?:errors?|exceptions?)[/\\]/i],
    symbolPatterns:  [/\b(?:handleError|errorHandler|AppError|HttpException|NotFoundError|formatError)\b/],
    contentPatterns: [/class\s+\w+Error\s+extends\s+Error/, /\berrorHandler\b/, /\.status\(\d{3}\)\.json\(/],
    importPatterns:  [/\bhttp-errors\b/, /\bboom\b/],
  },
  {
    name: 'configuration',
    pathPatterns:    [/(?:^|[/\\])(?:config|settings|env)[/\\]/i, /\.config\.[jt]s$/i, /\.env(?:\.\w+)?$/i],
    symbolPatterns:  [/\b(?:getConfig|loadConfig|Config|settings|envVar)\b/],
    contentPatterns: [/\bprocess\.env\b/, /\bdotenv\b/, /\bconfig\.\w+\s*=/],
    importPatterns:  [/\bdotenv\b/, /\bconfig\b/, /\bconvict\b/],
  },
  {
    name: 'testing',
    pathPatterns:    [/(?:^|[/\\])(?:tests?|__tests__|spec)[/\\]/i, /\.(?:test|spec)\.[jt]sx?$/i],
    symbolPatterns:  [/\b(?:describe|it|test|expect|assert|beforeEach|afterAll|suite|testAsync)\b/],
    contentPatterns: [/\bdescribe\s*\(/, /\bit\s*\(/, /\bexpect\s*\(/, /\bassert\b/],
    importPatterns:  [/\bjest\b/, /\bmocha\b/, /\bvitest\b/, /\bchai\b/],
  },
  {
    name: 'websocket',
    pathPatterns:    [/(?:^|[/\\])(?:ws|websocket|realtime|socket)[/\\]/i],
    symbolPatterns:  [/\b(?:WebSocket|wsServer|onMessage|onConnection|socketHandler|broadcast)\b/],
    contentPatterns: [/\bWebSocket\b/, /\bSocket\.IO\b/i, /\bws\b.*\.on\s*\(\s*['"]message/, /\.emit\s*\(/],
    importPatterns:  [/\bws\b/, /\bsocket\.io\b/],
  },
  {
    name: 'file-system',
    pathPatterns:    [/(?:^|[/\\])(?:files?|storage|uploads?|assets)[/\\]/i],
    symbolPatterns:  [/\b(?:readFile|writeFile|uploadFile|saveFile|deleteFile|streamFile|multer)\b/],
    contentPatterns: [/\bfs\.(?:read|write|unlink|mkdir|stat)\b/, /\bmulter\b/, /\bformidable\b/],
    importPatterns:  [/\bfs\/promises\b/, /\bmulter\b/, /\bformidable\b/, /\bfs-extra\b/],
  },
];

// ─── Concept Registry ──────────────────────────────────────────────────────

export class ConceptRegistry {
  constructor() {
    this._concepts = new Map();  // conceptName → { name, files: Set, symbols: Set, milestoneIds: Set }
    this._fileMap = new Map();   // filePath → Set<conceptName>
  }

  /**
   * Scan files and detect concepts.
   *
   * @param {Array<{file: string, content?: string, symbols?: string[], imports?: string[]}>} files
   * @param {Object} [opts]
   * @param {string} [opts.milestoneId] — Associate detected concepts with a milestone
   * @returns {Map<string, Object>} conceptName → concept entry
   */
  scan(files, opts = {}) {
    const milestoneId = opts.milestoneId || null;

    for (const f of files) {
      const matchedConcepts = this._classifyFile(f);

      for (const conceptName of matchedConcepts) {
        let entry = this._concepts.get(conceptName);
        if (!entry) {
          entry = { name: conceptName, files: new Set(), symbols: new Set(), milestoneIds: new Set() };
          this._concepts.set(conceptName, entry);
        }

        entry.files.add(f.file);
        if (milestoneId) entry.milestoneIds.add(milestoneId);

        // Track symbols belonging to this concept
        if (f.symbols) {
          const sig = CONCEPT_SIGNATURES.find(s => s.name === conceptName);
          if (sig) {
            for (const sym of f.symbols) {
              if (sig.symbolPatterns.some(p => p.test(sym))) {
                entry.symbols.add(sym);
              }
            }
          }
        }

        // Reverse index
        let fileSet = this._fileMap.get(f.file);
        if (!fileSet) { fileSet = new Set(); this._fileMap.set(f.file, fileSet); }
        fileSet.add(conceptName);
      }
    }

    return this._concepts;
  }

  /**
   * Scan from an existing KnowledgeGraph (uses file index + symbol data).
   *
   * @param {Object} graph — KnowledgeGraph instance
   * @param {Object} [opts]
   * @returns {Map<string, Object>}
   */
  scanFromGraph(graph, opts = {}) {
    if (!graph || !graph._fileIndex) return this._concepts;

    const files = [];
    for (const relPath of graph._fileIndex.keys()) {
      const syms = graph.getFileSymbols(relPath);
      const symbolNames = syms.map(s => s.name);
      const deps = graph.getDependencies(relPath);
      const importNames = deps.map(d => d.name || d.id || '');

      files.push({
        file: relPath,
        symbols: symbolNames,
        imports: importNames,
        // No content — use path + symbols + imports only
      });
    }

    return this.scan(files, opts);
  }

  /**
   * Classify a single file into zero or more concepts.
   * @private
   */
  _classifyFile(f) {
    const matched = [];

    for (const sig of CONCEPT_SIGNATURES) {
      let score = 0;

      // Path match = strong signal (+2)
      if (sig.pathPatterns.some(p => p.test(f.file))) {
        score += 2;
      }

      // Symbol name match = strong signal (+2)
      if (f.symbols && sig.symbolPatterns.some(sp =>
        f.symbols.some(sym => sp.test(sym))
      )) {
        score += 2;
      }

      // Content match = medium signal (+1 each, cap at 2)
      if (f.content) {
        let contentHits = 0;
        for (const p of sig.contentPatterns) {
          if (p.test(f.content)) contentHits++;
        }
        score += Math.min(contentHits, 2);
      }

      // Import match = medium signal (+1 each, cap at 2)
      if (f.imports) {
        let importHits = 0;
        for (const p of sig.importPatterns) {
          if (f.imports.some(imp => p.test(imp))) importHits++;
        }
        score += Math.min(importHits, 2);
      }

      // Threshold: path/symbol match alone (score >= 2) or 2+ content/import matches
      if (score >= 2) {
        matched.push(sig.name);
      }
    }

    return matched;
  }

  // ─── Query API ──────────────────────────────────────────────────────

  /** @returns {string[]} All detected concept names */
  getConceptNames() {
    return [...this._concepts.keys()];
  }

  /** @returns {Map<string, Object>} All concepts */
  getConcepts() {
    return this._concepts;
  }

  /**
   * Get concept entry by name.
   * @param {string} name
   * @returns {Object|null}
   */
  getConcept(name) {
    return this._concepts.get(name) || null;
  }

  /**
   * Get concepts for a file path.
   * @param {string} filePath
   * @returns {string[]}
   */
  getConceptsForFile(filePath) {
    const set = this._fileMap.get(filePath);
    return set ? [...set] : [];
  }

  /**
   * Get files belonging to a concept.
   * @param {string} conceptName
   * @returns {string[]}
   */
  getFilesForConcept(conceptName) {
    const entry = this._concepts.get(conceptName);
    return entry ? [...entry.files] : [];
  }

  // ─── Fragmentation Analysis ──────────────────────────────────────────

  /**
   * Compute fragmentation score for each concept.
   * Fragmentation = concept spread across multiple modules.
   *
   * @returns {Array<{concept: string, files: number, modules: number, fragmentation: number, moduleList: string[]}>}
   *   fragmentation: 0.0 (single module) to 1.0 (every file in different module)
   *   Sorted by fragmentation descending.
   */
  getFragmentation() {
    const results = [];

    for (const [name, entry] of this._concepts) {
      if (entry.files.size < 2) continue; // single-file concept = no fragmentation

      const modules = new Set();
      for (const file of entry.files) {
        const mod = _moduleForFile(file);
        if (mod) modules.add(mod);
      }

      if (modules.size < 2) continue; // all in one module = no fragmentation

      // Fragmentation = 1 - (1 / modules.size)
      // 2 modules → 0.5, 3 → 0.67, 5 → 0.8
      const fragmentation = Math.round((1 - 1 / modules.size) * 100) / 100;

      results.push({
        concept: name,
        files: entry.files.size,
        modules: modules.size,
        fragmentation,
        moduleList: [...modules].sort(),
      });
    }

    return results.sort((a, b) => b.fragmentation - a.fragmentation);
  }

  // ─── Drift Detection ─────────────────────────────────────────────────

  /**
   * Compare this registry against a previous snapshot to detect concept drift.
   * Drift = concepts that moved to different modules or fragmented further.
   *
   * @param {ConceptRegistry} previous
   * @returns {Array<{concept: string, type: string, message: string, details: Object}>}
   */
  detectDrift(previous) {
    if (!previous || previous._concepts.size === 0) return [];

    const drifts = [];

    for (const [name, current] of this._concepts) {
      const prev = previous._concepts.get(name);
      if (!prev) {
        // New concept appeared
        if (current.files.size >= 2) {
          drifts.push({
            concept: name,
            type: 'NEW_CONCEPT',
            message: `New concept "${name}" detected across ${current.files.size} files`,
            details: { files: [...current.files] },
          });
        }
        continue;
      }

      // Module comparison
      const prevModules = _getModulesForFiles(prev.files);
      const currModules = _getModulesForFiles(current.files);

      // New modules that weren't in previous
      const newModules = [...currModules].filter(m => !prevModules.has(m));
      if (newModules.length > 0) {
        drifts.push({
          concept: name,
          type: 'CONCEPT_SPREAD',
          message: `"${name}" spread to ${newModules.length} new module(s): ${newModules.join(', ')}`,
          details: {
            previousModules: [...prevModules],
            currentModules: [...currModules],
            newModules,
          },
        });
      }

      // Files that moved between modules
      const prevFileModules = _fileModuleMap(prev.files);
      const currFileModules = _fileModuleMap(current.files);
      for (const [file, currMod] of currFileModules) {
        const prevMod = prevFileModules.get(file);
        if (prevMod && prevMod !== currMod) {
          drifts.push({
            concept: name,
            type: 'FILE_MIGRATED',
            message: `"${name}" file migrated: ${file} (${prevMod} → ${currMod})`,
            details: { file, from: prevMod, to: currMod },
          });
        }
      }
    }

    // Check for concepts that disappeared
    for (const [name, prev] of previous._concepts) {
      if (!this._concepts.has(name) && prev.files.size >= 2) {
        drifts.push({
          concept: name,
          type: 'CONCEPT_REMOVED',
          message: `Concept "${name}" no longer detected (was in ${prev.files.size} files)`,
          details: { previousFiles: [...prev.files] },
        });
      }
    }

    return drifts;
  }

  // ─── Prompt Formatting ────────────────────────────────────────────────

  /**
   * Format fragmentation warnings for architecture brief injection.
   * @param {number} [minFragmentation=0.5] — Only include concepts above this threshold
   * @returns {string} Markdown section (empty if no fragmented concepts)
   */
  formatForPrompt(minFragmentation = 0.5) {
    const fragmented = this.getFragmentation().filter(f => f.fragmentation >= minFragmentation);
    if (fragmented.length === 0) return '';

    const parts = ['### Concept Fragmentation Warnings'];
    for (const f of fragmented.slice(0, 8)) {
      parts.push(`- **${f.concept}**: ${f.files} files across ${f.modules} modules (${f.moduleList.join(', ')})`);
    }
    parts.push('', 'Consider consolidating fragmented concepts into a single module where possible.');
    return parts.join('\n');
  }

  /**
   * Format drift report for checkpoint enrichment.
   * @param {Array} drifts — From detectDrift()
   * @returns {string}
   */
  static formatDriftForCheckpoint(drifts) {
    if (!drifts || drifts.length === 0) return '';

    const parts = ['### Concept Drift Detected'];
    for (const d of drifts.slice(0, 10)) {
      parts.push(`- **${d.type}**: ${d.message}`);
    }
    return parts.join('\n');
  }

  /** Reset registry */
  clear() {
    this._concepts.clear();
    this._fileMap.clear();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _moduleForFile(relPath) {
  const parts = relPath.split('/');
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : null;
}

function _getModulesForFiles(fileSet) {
  const modules = new Set();
  for (const file of fileSet) {
    const mod = _moduleForFile(file);
    if (mod) modules.add(mod);
  }
  return modules;
}

function _fileModuleMap(fileSet) {
  const map = new Map();
  for (const file of fileSet) {
    const mod = _moduleForFile(file);
    if (mod) map.set(file, mod);
  }
  return map;
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const conceptRegistry = new ConceptRegistry();

export default { ConceptRegistry, conceptRegistry, CONCEPT_SIGNATURES };
