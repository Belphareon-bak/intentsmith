// Architectural Drift Detector v1 — Detects deviations from intended architecture
// ══════════════════════════════════════════════════════════════════════════════
//
// Checks for:
//   1. Layer violations (UI importing DB, controller importing view, etc.)
//   2. Circular dependencies (A→B→C→A)
//   3. Naming convention violations (file/class naming patterns)
//   4. Import boundary violations (module X shouldn't import module Y)
//
// Uses architecture-detector.js patterns + knowledge-graph.js edges.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles } from './index-builder.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Layer Hierarchy ─────────────────────────────────────────────────────────

const DEFAULT_LAYERS = [
  { name: 'ui',         dirs: ['components', 'views', 'pages', 'ui', 'templates', 'frontend'] },
  { name: 'controller', dirs: ['controllers', 'handlers', 'routes', 'api', 'endpoints'] },
  { name: 'service',    dirs: ['services', 'service', 'usecases', 'use-cases', 'business'] },
  { name: 'repository', dirs: ['repositories', 'repository', 'repos', 'dao', 'data'] },
  { name: 'model',      dirs: ['models', 'model', 'entities', 'entity', 'domain', 'types'] },
  { name: 'infra',      dirs: ['infra', 'infrastructure', 'config', 'db', 'database', 'migrations'] },
  { name: 'util',       dirs: ['utils', 'util', 'helpers', 'lib', 'shared', 'common'] },
];

// Allowed import directions: higher layer → lower layer (top-down only)
// ui → controller → service → repository → model
// util can be imported by anyone
// infra can be imported by service, repository
const ALLOWED_IMPORTS = {
  ui:         ['controller', 'service', 'model', 'util'],
  controller: ['service', 'model', 'util'],
  service:    ['repository', 'model', 'util', 'infra'],
  repository: ['model', 'util', 'infra'],
  model:      ['util'],
  infra:      ['model', 'util'],
  util:       [],
};

// ─── Import Extraction ──────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // JS/TS: import X from './path' or require('./path')
  /(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g,
  // Python: from package import X
  /from\s+([\w.]+)\s+import/g,
  // Go: import "path"
  /import\s+"([^"]+)"/g,
  // Java: import com.example.pkg
  /import\s+([\w.]+);/g,
];

function extractImports(content) {
  const imports = [];
  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

// ─── Layer Detection ─────────────────────────────────────────────────────────

function detectLayer(filePath, layers) {
  const parts = filePath.split(/[/\\]/);
  for (const part of parts) {
    const lower = part.toLowerCase();
    for (const layer of layers) {
      if (layer.dirs.includes(lower)) return layer.name;
    }
  }
  return null;
}

// ─── Drift Detector ──────────────────────────────────────────────────────────

export class DriftDetector {
  constructor(layers = DEFAULT_LAYERS, allowed = ALLOWED_IMPORTS) {
    this._layers = layers;
    this._allowed = allowed;
    this._violations = [];
    this._circularDeps = [];
    this._namingIssues = [];
  }

  /**
   * Run full drift detection on a project.
   *
   * @param {string} projectPath
   * @param {Object} [opts]
   * @param {number} [opts.maxFiles=3000]
   * @param {Object} [opts.graph] - Knowledge graph for circular dep detection
   * @returns {Promise<Object>}
   */
  async analyze(projectPath, opts = {}) {
    const start = Date.now();
    this._violations = [];
    this._circularDeps = [];
    this._namingIssues = [];

    const files = await collectCodeFiles(projectPath, opts.maxFiles || 3000);

    // Build import map
    const importMap = new Map(); // file → [importedPaths]

    for (const relPath of files) {
      const absPath = path.join(projectPath, relPath);
      let content;
      try {
        content = await readFile(absPath, 'utf8');
        if (content.length > 1_048_576) continue;
      } catch { continue; }

      const imports = extractImports(content);
      importMap.set(relPath, imports);

      // Check naming conventions (always, regardless of layer)
      this._checkNaming(relPath, content);

      // Check layer violations
      const sourceLayer = detectLayer(relPath, this._layers);
      if (!sourceLayer) continue;

      for (const imp of imports) {
        // Only check relative imports (skip npm/stdlib)
        if (!imp.startsWith('.') && !imp.startsWith('/')) continue;

        const resolved = resolveImport(relPath, imp);
        const targetLayer = detectLayer(resolved, this._layers);

        if (targetLayer && sourceLayer !== targetLayer) {
          const allowedTargets = this._allowed[sourceLayer] || [];
          if (!allowedTargets.includes(targetLayer)) {
            this._violations.push({
              type: 'LAYER_VIOLATION',
              file: relPath,
              sourceLayer,
              targetLayer,
              import: imp,
              message: `${sourceLayer} → ${targetLayer}: ${relPath} imports from ${targetLayer} layer`,
            });
          }
        }
      }
    }

    // Detect circular dependencies
    this._detectCircular(importMap);

    const buildTime = Date.now() - start;

    logger.info('DriftDetector', `Analyzed ${files.length} files: ${this._violations.length} violations, ${this._circularDeps.length} circular deps (${buildTime}ms)`);

    return {
      violations: this._violations,
      circularDependencies: this._circularDeps,
      namingIssues: this._namingIssues,
      filesAnalyzed: files.length,
      buildTime,
    };
  }

  /**
   * Check naming conventions.
   */
  _checkNaming(filePath, content) {
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);

    // React components should be PascalCase
    if ((ext === '.jsx' || ext === '.tsx') && /^[a-z]/.test(baseName)) {
      if (baseName !== 'index' && !/^use[A-Z]/.test(baseName)) {
        this._namingIssues.push({
          type: 'NAMING_CONVENTION',
          file: filePath,
          message: `React component file should be PascalCase: ${baseName}`,
        });
      }
    }

    // Test files should match pattern
    if (/\.(test|spec)\.(js|ts|jsx|tsx)$/.test(filePath)) {
      // Test file — check that it has test-like content
      if (!content.includes('describe') && !content.includes('test(') &&
          !content.includes('it(') && !content.includes('suite(') &&
          !content.includes('assert')) {
        this._namingIssues.push({
          type: 'NAMING_MISMATCH',
          file: filePath,
          message: `File named as test but contains no test constructs`,
        });
      }
    }
  }

  /**
   * Detect circular dependencies via DFS.
   */
  _detectCircular(importMap) {
    const visited = new Set();
    const stack = new Set();
    const cycles = [];

    const dfs = (file, path) => {
      if (stack.has(file)) {
        const cycleStart = path.indexOf(file);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          cycle.push(file);
          // Normalize cycle (start from smallest element)
          const minIdx = cycle.indexOf(cycle.reduce((a, b) => a < b ? a : b));
          const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
          const key = normalized.join('→');
          if (!cycles.some(c => c.key === key)) {
            cycles.push({ key, files: normalized, length: normalized.length });
          }
        }
        return;
      }

      if (visited.has(file)) return;
      visited.add(file);
      stack.add(file);

      const imports = importMap.get(file) || [];
      for (const imp of imports) {
        if (!imp.startsWith('.')) continue;
        const resolved = resolveImport(file, imp);
        // Find actual file in importMap
        const actual = findFileInMap(importMap, resolved);
        if (actual) dfs(actual, [...path, file]);
      }

      stack.delete(file);
    };

    for (const file of importMap.keys()) {
      dfs(file, []);
    }

    this._circularDeps = cycles.slice(0, 20); // Cap at 20
  }

  getViolations() { return [...this._violations]; }
  getCircularDeps() { return [...this._circularDeps]; }
  getNamingIssues() { return [...this._namingIssues]; }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatDriftReport(result) {
  const parts = ['## Architectural Drift Analysis'];

  if (result.violations.length > 0) {
    parts.push('', '### Layer Violations');
    for (const v of result.violations.slice(0, 20)) {
      parts.push(`- **${v.sourceLayer} → ${v.targetLayer}**: \`${v.file}\` imports \`${v.import}\``);
    }
  } else {
    parts.push('', '### Layer Violations', 'No layer violations detected.');
  }

  if (result.circularDependencies.length > 0) {
    parts.push('', '### Circular Dependencies');
    for (const c of result.circularDependencies.slice(0, 10)) {
      parts.push(`- ${c.files.map(f => `\`${f}\``).join(' → ')}`);
    }
  } else {
    parts.push('', '### Circular Dependencies', 'No circular dependencies detected.');
  }

  if (result.namingIssues.length > 0) {
    parts.push('', '### Naming Convention Issues');
    for (const n of result.namingIssues.slice(0, 15)) {
      parts.push(`- \`${n.file}\`: ${n.message}`);
    }
  }

  parts.push('', '---', `*Analyzed ${result.filesAnalyzed} files in ${result.buildTime}ms*`);
  return parts.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveImport(fromFile, importPath) {
  const dir = path.dirname(fromFile);
  return path.normalize(path.join(dir, importPath)).replace(/\\/g, '/');
}

function findFileInMap(importMap, resolved) {
  // Try exact match, then with extensions
  if (importMap.has(resolved)) return resolved;
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.mjs']) {
    if (importMap.has(resolved + ext)) return resolved + ext;
  }
  // Try index file
  for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
    const idx = resolved + '/index' + ext;
    if (importMap.has(idx)) return idx;
  }
  return null;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const driftDetector = new DriftDetector();

export default { DriftDetector, driftDetector, formatDriftReport };
