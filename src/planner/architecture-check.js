// Architecture Contract Files (ACF) v97 — Deterministic Architecture Check
// ══════════════════════════════════════════════════════════════════════════════
// Machine-readable architecture contracts that projects must respect during
// the entire lifecycle. ARCHITECTURE.json defines layers, dependency rules,
// and file structure. Checked after each milestone.
//
// Pipeline: scan imports → map file → layer → validate rules → score
// ══════════════════════════════════════════════════════════════════════════════

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

// ─── Import Scanners ────────────────────────────────────────────────────────

const IMPORT_PATTERNS = {
  javascript: [
    /import\s+(?:.*?\s+from\s+)?['"](.*?)['"]/g,         // ESM import
    /require\s*\(\s*['"](.*?)['"]\s*\)/g,                 // CommonJS require
    /import\s*\(\s*['"](.*?)['"]\s*\)/g,                  // Dynamic import
  ],
  python: [
    /^\s*import\s+([\w.]+)/gm,                             // import module
    /^\s*from\s+([\w.]+)\s+import/gm,                      // from module import
  ],
  go: [
    /^\s*"(.+?)"/gm,                                       // import "pkg"
  ],
  java: [
    /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm,          // import com.foo.Bar;
  ],
};

/**
 * Extract import/require paths from source code.
 * @param {string} code - File contents
 * @param {string} lang - 'javascript' | 'python' | 'go'
 * @returns {string[]} Array of imported module paths
 */
export function scanImports(code, lang) {
  const patterns = IMPORT_PATTERNS[lang];
  if (!patterns) return [];

  const imports = [];
  for (const pattern of patterns) {
    // Reset regex state for each use
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(code))) {
      const importPath = m[1];
      // Skip built-in/external modules (no relative path)
      if (importPath && !importPath.startsWith('.')) {
        imports.push(importPath);
      } else if (importPath) {
        imports.push(importPath);
      }
    }
  }

  return imports;
}

// ─── File → Layer Mapping ───────────────────────────────────────────────────

/**
 * Map a file path to its architecture layer using the contract's fileStructure.
 * @param {string} filePath - Relative path from project root (e.g. 'src/controllers/userController.js')
 * @param {Object} contract - ARCHITECTURE.json content
 * @returns {string|null} Layer name or null if no match
 */
export function mapFileToLayer(filePath, contract) {
  if (!contract?.fileStructure) return null;

  const normalized = filePath.replace(/\\/g, '/');

  for (const [layer, layerPath] of Object.entries(contract.fileStructure)) {
    const normalizedLayerPath = layerPath.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedLayerPath + '/') || normalized === normalizedLayerPath) {
      return layer;
    }
  }

  return null;
}

/**
 * Resolve an import path to a layer.
 * @param {string} importPath - Import/require path
 * @param {string} sourceFile - File that contains the import
 * @param {Object} contract - ARCHITECTURE.json content
 * @returns {string|null} Target layer or null
 */
function resolveImportLayer(importPath, sourceFile, contract) {
  if (!contract?.fileStructure) return null;

  // Resolve relative import to absolute-ish path
  let resolved;
  if (importPath.startsWith('.')) {
    resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceFile), importPath)
    );
  } else {
    resolved = importPath;
  }

  return mapFileToLayer(resolved, contract);
}

// ─── Rule Validation ────────────────────────────────────────────────────────

/**
 * Check a single import against architecture rules.
 * @param {string} fromLayer - Source layer
 * @param {string} toLayer - Target layer (from import)
 * @param {Object[]} rules - Contract rules array
 * @returns {{ allowed: boolean, rule: string|null }}
 */
function checkRule(fromLayer, toLayer, rules) {
  if (fromLayer === toLayer) return { allowed: true, rule: null };
  if (!rules) return { allowed: true, rule: null };

  const rule = rules.find(r => r.from === fromLayer);
  if (!rule) return { allowed: true, rule: null }; // No rule for this layer = allowed

  // Explicit deny
  if (rule.cannotImport?.includes(toLayer)) {
    return { allowed: false, rule: `${fromLayer} cannot import ${toLayer}` };
  }

  // If canImport is specified, it's a whitelist
  if (rule.canImport && !rule.canImport.includes(toLayer)) {
    return { allowed: false, rule: `${fromLayer} can only import: ${rule.canImport.join(', ')}` };
  }

  return { allowed: true, rule: null };
}

// ─── File Discovery ─────────────────────────────────────────────────────────

const LANG_EXTS = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'javascript', '.tsx': 'javascript', '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
};

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', 'vendor', '.venv', 'dist', 'build']);

async function discoverSourceFiles(projectPath, maxFiles = 200) {
  const files = [];

  async function walk(dir, depth = 0) {
    if (depth > 8 || files.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (LANG_EXTS[path.extname(e.name)]) {
        files.push(path.relative(projectPath, full));
      }
    }
  }

  await walk(projectPath);
  return files;
}

// ─── Main: validateArchitecture ─────────────────────────────────────────────

/**
 * Validate project architecture against ARCHITECTURE.json contract.
 * @param {string} projectPath - Absolute project path
 * @param {Object} [contract] - Pre-loaded contract (if null, reads from projectPath/ARCHITECTURE.json)
 * @returns {Promise<{ score: number, violations: Object[], totalFiles: number, checkedFiles: number }>}
 */
export async function validateArchitecture(projectPath, contract = null) {
  // Load contract if not provided
  if (!contract) {
    try {
      const contractPath = path.join(projectPath, 'ARCHITECTURE.json');
      const raw = await readFile(contractPath, 'utf-8');
      contract = JSON.parse(raw);
    } catch {
      return { score: 1.0, violations: [], totalFiles: 0, checkedFiles: 0, skipped: true };
    }
  }

  if (!contract?.layers || !contract?.rules || !contract?.fileStructure) {
    return { score: 1.0, violations: [], totalFiles: 0, checkedFiles: 0, skipped: true };
  }

  const files = await discoverSourceFiles(projectPath);
  const violations = [];
  let checkedFiles = 0;

  for (const file of files) {
    const fromLayer = mapFileToLayer(file, contract);
    if (!fromLayer) continue; // File not in any defined layer
    checkedFiles++;

    const ext = path.extname(file);
    const lang = LANG_EXTS[ext];
    if (!lang) continue;

    let code;
    try {
      code = await readFile(path.join(projectPath, file), 'utf-8');
    } catch { continue; }

    const imports = scanImports(code, lang);

    for (const imp of imports) {
      const toLayer = resolveImportLayer(imp, file, contract);
      if (!toLayer) continue; // Import target not in a defined layer

      const { allowed, rule } = checkRule(fromLayer, toLayer, contract.rules);
      if (!allowed) {
        violations.push({
          file,
          import: imp,
          fromLayer,
          toLayer,
          rule,
        });
      }
    }
  }

  // Score: 1.0 = perfect, 0.0 = all files violate
  const score = checkedFiles === 0 ? 1.0 : Math.max(0, 1 - (violations.length / checkedFiles));

  logger.info('ArchitectureCheck', `Score: ${score.toFixed(2)} (${violations.length} violations in ${checkedFiles} files)`, {
    totalFiles: files.length,
    checkedFiles,
    violationCount: violations.length,
  });

  return { score, violations, totalFiles: files.length, checkedFiles };
}

// ─── Contract Generation Prompt ─────────────────────────────────────────────

/**
 * Generate a prompt for D1 to create ARCHITECTURE.json from a spec.
 * @param {Object} spec - Project specification
 * @returns {string}
 */
export function architectureContractPrompt(spec) {
  return `Based on the following project specification, generate an ARCHITECTURE.json file that defines:

1. "layers" — ordered array of architectural layers (e.g., ["controllers", "services", "repositories", "models"])
2. "rules" — dependency rules: which layer can import which
3. "fileStructure" — mapping of layer name to directory path

Project specification:
${JSON.stringify(spec, null, 2)}

RULES for generating the contract:
- Follow standard layered architecture: presentation → business → data
- Controllers/routes should NOT import repositories/database directly
- Services should NOT import controllers
- Models/schemas should be importable by any layer
- Use the tech stack from the spec to determine naming conventions

Respond with ONLY the JSON object, no explanation, no markdown.

Example format:
{
  "layers": ["controllers", "services", "repositories", "models"],
  "rules": [
    {"from": "controllers", "canImport": ["services", "models"], "cannotImport": ["repositories"]},
    {"from": "services", "canImport": ["repositories", "models"], "cannotImport": ["controllers"]},
    {"from": "repositories", "canImport": ["models"], "cannotImport": ["controllers", "services"]}
  ],
  "fileStructure": {
    "controllers": "src/controllers",
    "services": "src/services",
    "repositories": "src/repositories",
    "models": "src/models"
  }
}`;
}
