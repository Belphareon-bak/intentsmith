// M3 L0-8 — executable import boundary for specialist packages.
//
// This scanner is shared by the boot-time loader and the repository ratchet so
// the product cannot accept a package that CI would reject (or vice versa).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

const CODE_EXTENSION = /\.(?:cjs|js|jsx|mjs)$/i;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);

let parser = null;
const scanCache = new Map();

function getParser() {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(JavaScript);
  }
  return parser;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realpathIfPresent(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function resolveImportTarget(fromFile, specifier) {
  let base;
  if (specifier.startsWith('file:')) {
    try {
      base = fileURLToPath(specifier);
    } catch {
      return null;
    }
  } else if (path.isAbsolute(specifier)) {
    base = specifier;
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    const canonical = realpathIfPresent(candidate);
    if (canonical) return { lexical: path.resolve(candidate), canonical };
  }

  return { lexical: path.resolve(base), canonical: null };
}

function stringValue(node) {
  if (!node || node.type !== 'string') return null;
  const raw = node.text.slice(1, -1);
  // Escaped module specifiers need JavaScript evaluation to resolve. Reject
  // them as unverifiable instead of letting an encoded ../src edge through.
  if (raw.includes('\\')) return null;
  const fragment = node.namedChildren.find((child) => child.type === 'string_fragment');
  return fragment?.text ?? '';
}

function collectSourceFacts(source, file) {
  const tree = getParser().parse(source);
  const runtimeImports = [];
  const typeReferences = [];
  const computedImports = [];

  function visit(node) {
    if (node.type === 'import_statement' || node.type === 'export_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const specifier = stringValue(sourceNode);
        if (specifier === null) {
          computedImports.push({
            kind: node.type === 'import_statement' ? 'import' : 'export',
            line: node.startPosition.row + 1,
          });
        } else {
          runtimeImports.push({
            kind: node.type === 'import_statement' ? 'import' : 'export',
            specifier,
            line: node.startPosition.row + 1,
          });
        }
      }
    } else if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      if (callee?.type === 'import' || (callee?.type === 'identifier' && callee.text === 'require')) {
        const args = node.childForFieldName('arguments');
        const firstArgument = args?.namedChildren?.find((child) => child.type !== 'comment') || null;
        const specifier = stringValue(firstArgument);
        const kind = callee.type === 'import' ? 'dynamic_import' : 'require';
        if (specifier === null) {
          computedImports.push({ kind, line: node.startPosition.row + 1 });
        } else {
          runtimeImports.push({ kind, specifier, line: node.startPosition.row + 1 });
        }
      }
    } else if (node.type === 'comment') {
      const expression = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = expression.exec(node.text))) {
        typeReferences.push({
          specifier: match[1],
          line: node.startPosition.row + node.text.slice(0, match.index).split('\n').length,
        });
      }
    }

    for (const child of node.namedChildren) visit(child);
  }

  visit(tree.rootNode);
  return {
    runtimeImports,
    typeReferences,
    computedImports,
    parseError: tree.rootNode.hasError
      ? { file, reason: 'javascript_parse_error' }
      : null,
  };
}

function walkPackage(packageDir) {
  const files = [];
  const errors = [];
  const visitedDirectories = new Set();

  function walk(logicalDir) {
    let canonicalDir;
    try {
      canonicalDir = fs.realpathSync(logicalDir);
    } catch (error) {
      errors.push({ file: logicalDir, reason: 'directory_unreadable', message: error.message });
      return;
    }
    if (visitedDirectories.has(canonicalDir)) return;
    visitedDirectories.add(canonicalDir);

    let entries;
    try {
      entries = fs.readdirSync(logicalDir, { withFileTypes: true });
    } catch (error) {
      errors.push({ file: logicalDir, reason: 'directory_unreadable', message: error.message });
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const logicalPath = path.join(logicalDir, entry.name);
      let stat;
      try {
        stat = fs.statSync(logicalPath);
      } catch (error) {
        errors.push({ file: logicalPath, reason: 'path_unreadable', message: error.message });
        continue;
      }
      if (stat.isDirectory()) {
        walk(logicalPath);
      } else if (stat.isFile() && CODE_EXTENSION.test(entry.name)) {
        files.push(logicalPath);
      }
    }
  }

  walk(packageDir);
  return { files, errors };
}

function pointsIntoCore(fromFile, specifier, coreSourceRoot) {
  const target = resolveImportTarget(fromFile, specifier);
  if (!target) return false;
  return isWithin(coreSourceRoot, target.lexical)
    || (target.canonical !== null && isWithin(coreSourceRoot, target.canonical));
}

/**
 * Scan every executable JavaScript file in one specialist package.
 * JSDoc import() references are reported separately and do not violate L0-8.
 */
export function scanSpecialistPackage(packageDir, { projectRoot } = {}) {
  const absolutePackageDir = path.resolve(packageDir);
  const absoluteProjectRoot = path.resolve(projectRoot || path.join(absolutePackageDir, '..', '..'));
  const coreSourceRoot = realpathIfPresent(path.join(absoluteProjectRoot, 'src'))
    || path.resolve(absoluteProjectRoot, 'src');
  const { files, errors } = walkPackage(absolutePackageDir);
  const violations = [];
  const typeReferences = [];
  const computedImports = [];
  const sourceFiles = [];
  const digest = createHash('sha256');

  for (const file of files) {
    const relativeFile = normalizePath(path.relative(absoluteProjectRoot, file));
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (error) {
      errors.push({ file: relativeFile, reason: 'file_unreadable', message: error.message });
      continue;
    }

    digest.update(relativeFile);
    digest.update('\0');
    digest.update(realpathIfPresent(file) || path.resolve(file));
    digest.update('\0');
    digest.update(source);
    digest.update('\0');
    sourceFiles.push({ file, relativeFile, source });
  }

  const fingerprint = errors.length === 0 ? digest.digest('hex') : null;
  const cacheKey = `${absoluteProjectRoot}\0${absolutePackageDir}`;
  const cached = scanCache.get(cacheKey);
  if (fingerprint !== null && cached?.fingerprint === fingerprint) {
    return cached.result;
  }

  for (const { file, relativeFile, source } of sourceFiles) {
    const facts = collectSourceFacts(source, relativeFile);
    if (facts.parseError) errors.push(facts.parseError);

    for (const item of facts.runtimeImports) {
      if (pointsIntoCore(file, item.specifier, coreSourceRoot)) {
        violations.push({ file: relativeFile, ...item, reason: 'specialist_core_import' });
      }
    }
    for (const item of facts.typeReferences) {
      if (pointsIntoCore(file, item.specifier, coreSourceRoot)) {
        typeReferences.push({ file: relativeFile, ...item });
      }
    }
    for (const item of facts.computedImports) {
      computedImports.push({ file: relativeFile, ...item });
      violations.push({
        file: relativeFile,
        ...item,
        specifier: '<computed>',
        reason: 'computed_import_unverifiable',
      });
    }
  }

  const order = (left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || (left.specifier || '').localeCompare(right.specifier || '')
  );
  violations.sort(order);
  typeReferences.sort(order);
  computedImports.sort(order);
  errors.sort(order);

  const result = Object.freeze({
    ok: violations.length === 0 && errors.length === 0,
    packageDir: absolutePackageDir,
    scannedFiles: files.length,
    violations: Object.freeze(violations),
    typeReferences: Object.freeze(typeReferences),
    computedImports: Object.freeze(computedImports),
    errors: Object.freeze(errors),
  });
  if (fingerprint !== null) scanCache.set(cacheKey, { fingerprint, result });
  return result;
}

export function formatSpecialistBoundaryFailure(packageId, result) {
  const details = [
    ...result.violations.map((item) => `${item.file}:${item.line} -> ${item.specifier}`),
    ...result.errors.map((item) => `${item.file}: ${item.reason}`),
  ];
  return `Specialist ${packageId} violates L0-8: ${details.join(', ')}`;
}
