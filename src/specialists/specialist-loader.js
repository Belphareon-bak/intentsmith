// v74: Specialist Loader — MVP
// ══════════════════════════════════════════════════════════════════════════════
//
// Boot-time discovery, installation, and activation of specialist packages.
//
// Boot sequence:
//   1. discoverAll()   — scan specialists/ directory, parse + validate manifests
//   2. installPending() — run specialist migrations for newly discovered packages
//   3. enableAll()      — dynamic import index.js, register tools + seed knowledge
//
// Each specialist is a self-contained directory with specialist.json manifest.
// See docs/SPECIALIST-LIFECYCLE.md for full spec.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from '../core/logger.js';
import { ToolAdapter } from '../expertises/tool-adapter.js';

const SPECIALIST_EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SPECIALIST_CODE_LIKE_EXTENSIONS = new Set([
  '.jsx', '.ts', '.tsx', '.mts', '.cts', '.coffee', '.wasm',
]);
const SPECIALIST_SENSITIVE_DYNAMIC_PROPERTIES = new Set([
  'Function', '_load', 'constructor', 'createRequire', 'eval',
  'getBuiltinModule', 'mainModule', 'require',
]);
const SPECIALIST_DYNAMIC_AUTHORITY_RECEIVERS = new Set([
  'global', 'globalThis', 'module', 'process', 'window',
]);
const VERIFIED_SPECIALIST_PACKAGE_DIGESTS = new Set();

class SpecialistPreflightError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'SpecialistPreflightError';
    this.code = code;
  }
}

function normalizeSpecialistPath(value) {
  return value.split(path.sep).join('/');
}

function isInsideSpecialistRoot(parent, child) {
  const delta = path.relative(parent, child);
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${path.sep}`));
}

function assertInsideSpecialistRoot(parent, child, code, label) {
  if (!isInsideSpecialistRoot(parent, child)) {
    throw new SpecialistPreflightError(code, `${label} escapes package root`);
  }
}

function readSpecialistRegularFile(target, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `${label} cannot be inspected: ${error.message}`,
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      `${label} must be a regular non-symlink file`,
    );
  }
  if ((stat.mode & 0o444) === 0) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `${label} has no readable permission bit`,
    );
  }
  try {
    return { buffer: fs.readFileSync(target), stat };
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `${label} cannot be read: ${error.message}`,
    );
  }
}

function decodeSpecialistSource(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_SOURCE_DECODE_FAILED',
      `${label} is not valid UTF-8: ${error.message}`,
    );
  }
}

function syntaxCheckSpecialistSource(file, packageRoot, label) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new SpecialistPreflightError(
      'SPECIALIST_SOURCE_PARSE_FAILED',
      `${label}: ${result.error?.message || result.stderr.trim() || 'syntax check failed'}`,
    );
  }
}

function collectSpecialistPackage(packageDir) {
  let packageStat;
  try {
    packageStat = fs.lstatSync(packageDir);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `package cannot be inspected: ${error.message}`,
    );
  }
  if (packageStat.isSymbolicLink() || !packageStat.isDirectory()) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      'package root must be a non-symlink directory',
    );
  }

  let packageRoot;
  try {
    packageRoot = fs.realpathSync(packageDir);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `package root cannot be canonicalized: ${error.message}`,
    );
  }

  const hash = createHash('sha256');
  const sources = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      const label = normalizeSpecialistPath(path.relative(packageRoot, directory)) || '.';
      throw new SpecialistPreflightError(
        'SPECIALIST_TREE_READ_FAILED',
        `${label} cannot be enumerated: ${error.message}`,
      );
    }

    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const label = normalizeSpecialistPath(path.relative(packageRoot, target));
      let stat;
      try {
        stat = fs.lstatSync(target);
      } catch (error) {
        throw new SpecialistPreflightError(
          'SPECIALIST_TREE_READ_FAILED',
          `${label} cannot be inspected: ${error.message}`,
        );
      }
      if (stat.isSymbolicLink()) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNSAFE_TREE_ENTRY',
          `${label} is a symlink`,
        );
      }
      if (stat.isDirectory()) {
        let canonical;
        try {
          canonical = fs.realpathSync(target);
        } catch (error) {
          throw new SpecialistPreflightError(
            'SPECIALIST_TREE_READ_FAILED',
            `${label} cannot be canonicalized: ${error.message}`,
          );
        }
        assertInsideSpecialistRoot(
          packageRoot,
          canonical,
          'SPECIALIST_PATH_ESCAPE',
          label,
        );
        hash.update(`D\0${label}\0${stat.mode & 0o7777}\0`);
        walk(target);
        continue;
      }
      if (!stat.isFile()) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNSAFE_TREE_ENTRY',
          `${label} is not a regular file`,
        );
      }

      const { buffer } = readSpecialistRegularFile(target, label);
      hash.update(`F\0${label}\0${stat.mode & 0o7777}\0${buffer.length}\0`);
      hash.update(buffer);
      const extension = path.extname(entry.name).toLowerCase();
      if (SPECIALIST_EXECUTABLE_EXTENSIONS.has(extension)) {
        sources.push({
          file: target,
          label,
          source: decodeSpecialistSource(buffer, label),
        });
      } else if (
        SPECIALIST_CODE_LIKE_EXTENSIONS.has(extension)
        || (stat.mode & 0o111) !== 0
        || buffer.subarray(0, 2).toString() === '#!'
      ) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNKNOWN_EXECUTABLE_EXTENSION',
          `${label} is executable source outside .js/.mjs/.cjs`,
        );
      }
    }
  };

  walk(packageRoot);
  sources.sort((left, right) => left.file.localeCompare(right.file));
  return { digest: hash.digest('hex'), packageRoot, sources };
}

function specialistIdentifierStart(char) {
  return /[A-Za-z_$]/u.test(char || '');
}

function specialistIdentifierPart(char) {
  return /[A-Za-z0-9_$]/u.test(char || '');
}

function specialistRegexCanStart(previous) {
  if (!previous) return true;
  if (previous.type === 'punct') return /[({[=,:;!?&|+\-*%^~<>]/u.test(previous.value);
  return previous.type === 'identifier'
    && new Set([
      'return', 'throw', 'case', 'delete', 'void', 'typeof',
      'yield', 'await', 'else', 'do',
    ]).has(previous.value);
}

function tokenizeSpecialistSource(source, label) {
  const tokens = [];
  let index = 0;
  let previous = null;
  const push = (token) => {
    tokens.push(token);
    if (token.type !== 'comment') previous = token;
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '\\') {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
        `${label}: escaped executable identifiers are forbidden`,
      );
    }
    if (char === '/' && next === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      push({ type: 'comment', kind: 'line', value: source.slice(start, index), start });
      continue;
    }
    if (char === '/' && next === '*') {
      const start = index;
      const jsdoc = source[index + 2] === '*';
      const end = source.indexOf('*/', index + 2);
      if (end === -1) {
        throw new SpecialistPreflightError(
          'SPECIALIST_SOURCE_PARSE_FAILED',
          `${label}: unterminated block comment`,
        );
      }
      index = end + 2;
      push({
        type: 'comment',
        kind: jsdoc ? 'jsdoc' : 'block',
        value: source.slice(start, index),
        start,
      });
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      let escaped = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          escaped = true;
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      if (source[index - 1] !== quote) {
        throw new SpecialistPreflightError(
          'SPECIALIST_SOURCE_PARSE_FAILED',
          `${label}: unterminated string`,
        );
      }
      push({
        type: 'string',
        value: source.slice(start + 1, index - 1),
        escaped,
        start,
      });
      continue;
    }
    if (char === '`') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '`') {
          index += 1;
          break;
        }
        index += 1;
      }
      if (source[index - 1] !== '`') {
        throw new SpecialistPreflightError(
          'SPECIALIST_SOURCE_PARSE_FAILED',
          `${label}: unterminated template`,
        );
      }
      const value = source.slice(start, index);
      if (value.includes('${') && /\b(?:import|require)\b/u.test(value)) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_TEMPLATE_IMPORT',
          `${label}: template interpolation may not hide an import or require expression`,
        );
      }
      push({ type: 'template', value, start });
      continue;
    }
    if (char === '/' && specialistRegexCanStart(previous)) {
      const start = index;
      let inClass = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '[') inClass = true;
        else if (source[index] === ']') inClass = false;
        else if (source[index] === '/' && !inClass) {
          index += 1;
          while (/[A-Za-z]/u.test(source[index] || '')) index += 1;
          break;
        }
        if (source[index] === '\n') break;
        index += 1;
      }
      push({ type: 'regex', value: source.slice(start, index), start });
      continue;
    }
    if (specialistIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (specialistIdentifierPart(source[index])) index += 1;
      push({ type: 'identifier', value: source.slice(start, index), start });
      continue;
    }
    if (/[0-9]/u.test(char)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9._]/u.test(source[index] || '')) index += 1;
      push({ type: 'number', value: source.slice(start, index), start });
      continue;
    }
    push({ type: 'punct', value: char, start: index });
    index += 1;
  }
  return tokens;
}

function specialistStringValue(token, label) {
  if (token.escaped) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNSUPPORTED_ESCAPED_SPECIFIER',
      `${label}: escaped module specifiers are rejected instead of guessed`,
    );
  }
  return token.value;
}

function findSpecialistClosingDelimiter(tokens, openIndex, open, close, label) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new SpecialistPreflightError(
    'SPECIALIST_SOURCE_PARSE_FAILED',
    `${label}: unmatched ${open}${close} delimiter`,
  );
}

function findSpecialistClosingParen(tokens, openIndex, label) {
  return findSpecialistClosingDelimiter(tokens, openIndex, '(', ')', label);
}

function specialistMemberAccessOpen(tokens, index) {
  const previous = tokens[index - 1];
  return Boolean(previous) && (
    ['identifier', 'number', 'string', 'template'].includes(previous.type)
    || [')', ']', '}'].includes(previous.value)
  );
}

function foldSpecialistStaticProperty(tokens, openIndex, closeIndex, label) {
  const body = tokens.slice(openIndex + 1, closeIndex);
  if (body.length === 0) return null;
  let value = '';
  let expectValue = true;
  for (const token of body) {
    if (expectValue) {
      if (token.type === 'string') {
        if (token.escaped) {
          throw new SpecialistPreflightError(
            'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
            `${label}: escaped computed property names are forbidden`,
          );
        }
        value += token.value;
      } else if (
        token.type === 'template'
        && !token.value.includes('${')
        && !token.value.includes('\\')
      ) {
        value += token.value.slice(1, -1);
      } else {
        return null;
      }
    } else if (token.value !== '+') {
      return null;
    }
    expectValue = !expectValue;
  }
  return expectValue ? null : value;
}

function resolveSpecialistImport(packageRoot, file, specifier, label) {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u.exec(specifier)?.[0] || null;
  if (scheme) {
    if (scheme === 'node:') return;
    throw new SpecialistPreflightError(
      'SPECIALIST_UNPROVEN_MODULE_URL',
      `${label}: module URL scheme ${scheme} is forbidden`,
    );
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return;
  if (specifier.startsWith('/')) {
    throw new SpecialistPreflightError(
      'SPECIALIST_PATH_ESCAPE',
      `${label}: absolute module specifier is forbidden`,
    );
  }

  const clean = specifier.split(/[?#]/u, 1)[0];
  const lexical = path.resolve(path.dirname(file), clean);
  assertInsideSpecialistRoot(
    packageRoot,
    lexical,
    'SPECIALIST_PATH_ESCAPE',
    `${label} import ${specifier}`,
  );
  const candidates = [
    lexical,
    ...[...SPECIALIST_EXECUTABLE_EXTENSIONS].map((extension) => `${lexical}${extension}`),
    ...[...SPECIALIST_EXECUTABLE_EXTENSIONS]
      .map((extension) => path.join(lexical, `index${extension}`)),
  ];
  let selected = null;
  for (const candidate of candidates) {
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNSAFE_TREE_ENTRY',
        `${label}: imported target ${specifier} is a symlink`,
      );
    }
    if (stat.isFile()) {
      selected = fs.realpathSync(candidate);
      break;
    }
  }
  if (!selected) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNRESOLVED_IMPORT',
      `${label}: ${specifier} does not resolve to a regular package file`,
    );
  }
  assertInsideSpecialistRoot(
    packageRoot,
    selected,
    'SPECIALIST_PATH_ESCAPE',
    `${label} import ${specifier}`,
  );
}

function realSpecialistDirectory(target, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `${label} is unreadable: ${error.message}`,
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      `${label} must be a non-symlink directory`,
    );
  }
  try {
    return fs.realpathSync(target);
  } catch (error) {
    throw new SpecialistPreflightError(
      'SPECIALIST_TREE_READ_FAILED',
      `${label} cannot be canonicalized: ${error.message}`,
    );
  }
}

function resolveSpecialistExecutable(packageDir, relativePath, label) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(relativePath)
    || /[?#]/u.test(relativePath)
  ) {
    throw new SpecialistPreflightError(
      'SPECIALIST_EXECUTABLE_PATH_INVALID',
      `${label} must be a plain package-relative path`,
    );
  }
  const packageRoot = realSpecialistDirectory(packageDir, 'specialist package root');
  const lexical = path.resolve(packageRoot, relativePath);
  assertInsideSpecialistRoot(
    packageRoot,
    lexical,
    'SPECIALIST_PATH_ESCAPE',
    label,
  );
  const { stat } = readSpecialistRegularFile(lexical, label);
  const extension = path.extname(lexical).toLowerCase();
  if (!SPECIALIST_EXECUTABLE_EXTENSIONS.has(extension)) {
    throw new SpecialistPreflightError(
      'SPECIALIST_EXECUTABLE_PATH_INVALID',
      `${label} must use .js, .mjs, or .cjs`,
    );
  }
  const canonical = fs.realpathSync(lexical);
  assertInsideSpecialistRoot(
    packageRoot,
    canonical,
    'SPECIALIST_PATH_ESCAPE',
    label,
  );
  if (!stat.isFile()) {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      `${label} must be a regular file`,
    );
  }
  return canonical;
}

function specialistMigrationRelativePath(migrationName) {
  if (
    typeof migrationName !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(migrationName)
  ) {
    throw new SpecialistPreflightError(
      'SPECIALIST_MIGRATION_NAME_INVALID',
      'migration name must be a package-local identifier',
    );
  }
  return path.join('migrations', `${migrationName}.js`);
}

function resolveSpecialistMigration(packageDir, migrationName) {
  return resolveSpecialistExecutable(
    packageDir,
    specialistMigrationRelativePath(migrationName),
    `migration ${migrationName}`,
  );
}

function proveSpecialistComputedPackageLocal({ packageRoot, file, tokens, indexes, label }) {
  const isIdentifier = (index, value) => (
    tokens[index]?.type === 'identifier' && tokens[index].value === value
  );
  const isValue = (index, value) => tokens[index]?.value === value;
  const fail = (message) => {
    throw new SpecialistPreflightError(
      'SPECIALIST_UNPROVEN_COMPUTED_IMPORT',
      `${label}: ${message}`,
    );
  };
  const enclosingBraces = (targetIndex) => {
    const stack = [];
    for (let index = 0; index < targetIndex; index += 1) {
      if (isValue(index, '{')) stack.push(index);
      else if (isValue(index, '}')) stack.pop();
    }
    return stack;
  };

  const anchors = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'toolsDir') || !isValue(index + 1, '=')) continue;
    const exact = isIdentifier(index - 1, 'const')
      && isIdentifier(index + 2, 'path')
      && isValue(index + 3, '.')
      && isIdentifier(index + 4, 'join')
      && isValue(index + 5, '(')
      && isIdentifier(index + 6, '__dirname')
      && isValue(index + 7, ',')
      && tokens[index + 8]?.type === 'string'
      && specialistStringValue(tokens[index + 8], label) === 'tools'
      && isValue(index + 9, ')');
    if (!exact) fail('toolsDir has a non-canonical assignment');
    anchors.push(index);
  }
  if (anchors.length !== 1) fail('computed import lacks the exact toolsDir anchor');

  const definitions = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      isIdentifier(index, 'function')
      && isIdentifier(index + 1, 'buildToolDefinitions')
      && isValue(index + 2, '(')
      && isIdentifier(index + 3, 'toolsDir')
      && isValue(index + 4, ')')
    ) {
      if (!isValue(index + 5, '{')) fail('buildToolDefinitions must have a block body');
      definitions.push({
        index,
        bodyOpen: index + 5,
        bodyClose: findSpecialistClosingDelimiter(tokens, index + 5, '{', '}', label),
      });
    }
  }
  if (definitions.length !== 1) fail('exact buildToolDefinitions(toolsDir) is required');

  const calls = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'buildToolDefinitions') || !isValue(index + 1, '(')) continue;
    const close = findSpecialistClosingParen(tokens, index + 1, label);
    const args = tokens.slice(index + 2, close);
    if (args.length !== 1 || args[0].type !== 'identifier' || args[0].value !== 'toolsDir') {
      fail('every tool definition call must use only toolsDir');
    }
    calls.push(index);
  }
  if (calls.length < 2) fail('every tool definition call must use only toolsDir');

  const filenames = [];
  const modulePathDefinitions = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'modulePath') || !isValue(index + 1, ':')) continue;
    const exact = isIdentifier(index + 2, 'path')
      && isValue(index + 3, '.')
      && isIdentifier(index + 4, 'join')
      && isValue(index + 5, '(')
      && isIdentifier(index + 6, 'toolsDir')
      && isValue(index + 7, ',')
      && tokens[index + 8]?.type === 'string'
      && isValue(index + 9, ')');
    if (!exact) fail('every modulePath must use a literal package-local .js filename');
    const filename = specialistStringValue(tokens[index + 8], label);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(filename)) {
      fail('every modulePath must use a literal package-local .js filename');
    }
    if (index <= definitions[0].bodyOpen || index >= definitions[0].bodyClose) {
      fail('modulePath must be defined inside buildToolDefinitions');
    }
    modulePathDefinitions.add(index);
    filenames.push(filename);
  }
  if (filenames.length === 0) {
    fail('every modulePath must use a literal package-local .js filename');
  }

  const toolsBindings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'tools') || !isValue(index + 1, '=')) continue;
    const exact = isIdentifier(index - 1, 'const')
      && isIdentifier(index + 2, 'buildToolDefinitions')
      && isValue(index + 3, '(')
      && isIdentifier(index + 4, 'toolsDir')
      && isValue(index + 5, ')');
    if (!exact) fail('tools must come only from buildToolDefinitions(toolsDir)');
    toolsBindings.push(index);
  }
  if (toolsBindings.length !== 1) fail('exactly one canonical tools binding is required');

  const loops = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const exact = isIdentifier(index, 'for')
      && isValue(index + 1, '(')
      && isIdentifier(index + 2, 'const')
      && isIdentifier(index + 3, 'tool')
      && isIdentifier(index + 4, 'of')
      && isIdentifier(index + 5, 'tools')
      && isValue(index + 6, ')')
      && isValue(index + 7, '{');
    if (!exact) continue;
    loops.push({
      index,
      bodyOpen: index + 7,
      bodyClose: findSpecialistClosingDelimiter(tokens, index + 7, '{', '}', label),
    });
  }
  if (loops.length !== 1 || toolsBindings[0] >= loops[0].index) {
    fail('exact for (const tool of tools) loader loop is required');
  }
  const bindingScope = enclosingBraces(toolsBindings[0]);
  const loopScope = enclosingBraces(loops[0].index);
  if (
    bindingScope.length !== loopScope.length
    || bindingScope.some((brace, index) => brace !== loopScope[index])
  ) {
    fail('tools binding and loader loop must share the exact lexical scope');
  }
  for (let index = toolsBindings[0] + 1; index < loops[0].index; index += 1) {
    if (isIdentifier(index, 'tools')) fail('tools may not escape or mutate before the loader loop');
  }
  for (let index = loops[0].bodyOpen + 1; index < loops[0].bodyClose; index += 1) {
    if (isIdentifier(index, 'tool') && !isValue(index + 1, '.')) {
      fail('tool may not be rebound inside the loader loop');
    }
    if (isIdentifier(index, 'tools') && !isValue(index - 1, '.')) {
      fail('tools may not be referenced inside the loader loop');
    }
  }
  for (const index of indexes) {
    if (index <= loops[0].bodyOpen || index >= loops[0].bodyClose) {
      fail('computed import is outside the canonical loader loop');
    }
  }

  const computedModulePaths = new Set(indexes.map((index) => index + 4));
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'modulePath')) continue;
    if (!modulePathDefinitions.has(index) && !computedModulePaths.has(index)) {
      fail('modulePath use is outside the proven definition/import shape');
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const directMutation = isIdentifier(index, 'modulePath') && isValue(index + 1, '=');
    const dottedMutation = isValue(index, '.')
      && isIdentifier(index + 1, 'modulePath')
      && isValue(index + 2, '=');
    const bracketMutation = tokens[index]?.type === 'string'
      && tokens[index].value === 'modulePath'
      && isValue(index - 1, '[')
      && isValue(index + 1, ']')
      && isValue(index + 2, '=');
    const deleteMutation = isIdentifier(index, 'delete')
      && tokens.slice(index + 1, index + 7).some((token) => token.value === 'modulePath');
    if (directMutation || dottedMutation || bracketMutation || deleteMutation) {
      fail('modulePath mutation is forbidden');
    }
  }

  const toolsRoot = realSpecialistDirectory(
    path.join(packageRoot, 'tools'),
    `${label} tools directory`,
  );
  for (const filename of filenames) {
    const target = path.join(toolsRoot, filename);
    readSpecialistRegularFile(target, `${label} computed target ${filename}`);
    const canonical = fs.realpathSync(target);
    assertInsideSpecialistRoot(
      toolsRoot,
      canonical,
      'SPECIALIST_UNPROVEN_COMPUTED_IMPORT',
      `${label} computed target`,
    );
  }
}

function analyzeSpecialistSource({ packageRoot, file, label, source }) {
  const allTokens = tokenizeSpecialistSource(source, label);
  const comments = allTokens.filter((token) => token.type === 'comment');
  const tokens = allTokens.filter((token) => token.type !== 'comment');
  const computedImportIndexes = [];
  const checkSpecifier = (specifier) => {
    if (specifier === 'module' || specifier === 'node:module') {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
        `${label}: Node module loader authority is forbidden`,
      );
    }
    resolveSpecialistImport(packageRoot, file, specifier, label);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === '[' && specialistMemberAccessOpen(tokens, index)) {
      const close = findSpecialistClosingDelimiter(tokens, index, '[', ']', label);
      const property = foldSpecialistStaticProperty(tokens, index, close, label);
      const receiver = tokens[index - 1];
      if (
        property !== null
        && SPECIALIST_SENSITIVE_DYNAMIC_PROPERTIES.has(property)
      ) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
          `${label}: computed access to ${property} can hide an indirect module load`,
        );
      }
      if (
        property === null
        && receiver.type === 'identifier'
        && SPECIALIST_DYNAMIC_AUTHORITY_RECEIVERS.has(receiver.value)
      ) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
          `${label}: dynamic access to ${receiver.value} cannot prove a safe authority`,
        );
      }
    }
    if (token.type !== 'identifier') continue;
    if (token.value === 'Reflect') {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
        `${label}: Reflect can hide an indirect module load and is forbidden`,
      );
    }
    if (SPECIALIST_DYNAMIC_AUTHORITY_RECEIVERS.has(token.value)) {
      const next = tokens[index + 1];
      const property = tokens[index + 2];
      const bracketAccess = next?.value === '[';
      const dottedAccess = next?.value === '.' && property?.type === 'identifier';
      const safeModuleExport = token.value === 'module'
        && dottedAccess
        && property.value === 'exports';
      if (
        !bracketAccess
        && !safeModuleExport
        && (!dottedAccess || SPECIALIST_SENSITIVE_DYNAMIC_PROPERTIES.has(property.value))
      ) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
          `${label}: ${token.value} authority cannot be aliased or dynamically invoked`,
        );
      }
    }

    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (!next) {
        throw new SpecialistPreflightError(
          'SPECIALIST_SOURCE_PARSE_FAILED',
          `${label}: incomplete import`,
        );
      }
      if (next.value === '.') continue;
      if (next.value === '(') {
        const close = findSpecialistClosingParen(tokens, index + 1, label);
        const args = tokens.slice(index + 2, close);
        if (args.length === 1 && args[0].type === 'string') {
          checkSpecifier(specialistStringValue(args[0], label));
        } else if (
          args.length === 3
          && args[0].type === 'identifier'
          && args[0].value === 'tool'
          && args[1].value === '.'
          && args[2].type === 'identifier'
          && args[2].value === 'modulePath'
        ) {
          computedImportIndexes.push(index);
        } else {
          throw new SpecialistPreflightError(
            'SPECIALIST_UNPROVEN_COMPUTED_IMPORT',
            `${label}: computed import target is not statically package-local`,
          );
        }
        index = close;
      } else if (next.type === 'string') {
        checkSpecifier(specialistStringValue(next, label));
      } else {
        let found = null;
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
          if (tokens[cursor].value === ';') break;
          if (tokens[cursor].type === 'identifier' && tokens[cursor].value === 'from') {
            found = tokens[cursor + 1];
            break;
          }
        }
        if (!found || found.type !== 'string') {
          throw new SpecialistPreflightError(
            'SPECIALIST_SOURCE_PARSE_FAILED',
            `${label}: static import has no literal source`,
          );
        }
        checkSpecifier(specialistStringValue(found, label));
      }
    } else if (token.value === 'export') {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].value === ';') break;
        if (tokens[cursor].type === 'identifier' && tokens[cursor].value === 'from') {
          const specifier = tokens[cursor + 1];
          if (!specifier || specifier.type !== 'string') {
            throw new SpecialistPreflightError(
              'SPECIALIST_SOURCE_PARSE_FAILED',
              `${label}: re-export has no literal source`,
            );
          }
          checkSpecifier(specialistStringValue(specifier, label));
          break;
        }
      }
    } else if (token.value === 'require') {
      if (tokens[index + 1]?.value !== '(') {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_COMPUTED_REQUIRE',
          `${label}: aliased or indirect require is forbidden`,
        );
      }
      const close = findSpecialistClosingParen(tokens, index + 1, label);
      const args = tokens.slice(index + 2, close);
      if (args.length !== 1 || args[0].type !== 'string') {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNPROVEN_COMPUTED_REQUIRE',
          `${label}: computed require target is forbidden`,
        );
      }
      checkSpecifier(specialistStringValue(args[0], label));
      index = close;
    } else if (
      ['_load', 'eval', 'Function', 'createRequire', 'getBuiltinModule']
        .includes(token.value)
    ) {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
        `${label}: ${token.value} can hide an indirect module load and is forbidden`,
      );
    }
  }

  for (const comment of comments.filter((entry) => entry.kind === 'jsdoc')) {
    const matchedRanges = [];
    const regex = /\bimport\s*\(\s*(['"])([^'"\\]+)\1\s*\)/gu;
    let match;
    while ((match = regex.exec(comment.value))) {
      matchedRanges.push([match.index, regex.lastIndex]);
      checkSpecifier(match[2]);
    }
    const scrubbed = [...comment.value].map((char, charIndex) => (
      matchedRanges.some(([start, end]) => charIndex >= start && charIndex < end)
        ? ' '
        : char
    )).join('');
    if (/\bimport\s*\(/u.test(scrubbed)) {
      throw new SpecialistPreflightError(
        'SPECIALIST_UNPROVEN_JSDOC_IMPORT',
        `${label}: computed or escaped JSDoc import is forbidden`,
      );
    }
  }

  if (computedImportIndexes.length > 0) {
    proveSpecialistComputedPackageLocal({
      packageRoot,
      file,
      tokens,
      indexes: computedImportIndexes,
      label,
    });
  }
}

function preflightSpecialistPackage(packageDir, acceptedDigest = null) {
  const collected = collectSpecialistPackage(packageDir);
  if (
    collected.digest === acceptedDigest
    || VERIFIED_SPECIALIST_PACKAGE_DIGESTS.has(collected.digest)
  ) {
    return collected;
  }
  for (const source of collected.sources) {
    syntaxCheckSpecialistSource(source.file, collected.packageRoot, source.label);
    analyzeSpecialistSource({
      packageRoot: collected.packageRoot,
      ...source,
    });
  }
  VERIFIED_SPECIALIST_PACKAGE_DIGESTS.add(collected.digest);
  return collected;
}

// ── Engine version from package.json (fallback for default) ─────────────────
let _packageVersion = null;
function _readPackageVersion() {
  if (_packageVersion) return _packageVersion;
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _packageVersion = pkg.version || '122.0.0';
  } catch {
    _packageVersion = '122.0.0';
  }
  return _packageVersion;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// v121: Lazy-loaded registries for specialist ctx.registries
let _autoSelectReg = null;
let _creReg = null;
let _toolExecutorRef = null;

async function _ensureAutoSelect() {
  if (!_autoSelectReg) {
    const mod = await import('../expertises/auto-select.js');
    _autoSelectReg = {
      registerBoostPatterns: mod.registerBoostPatterns,
      unregisterBoostPatterns: mod.unregisterBoostPatterns,
      getPatterns: mod.getBoostPatterns,
    };
  }
  return _autoSelectReg;
}

async function _ensureCRE() {
  if (!_creReg) {
    const mod = await import('../chat/cre-decision.js');
    _creReg = {
      registerToolType: mod.registerToolType,
      unregisterToolType: mod.unregisterToolType,
      isKnownTool: mod.isKnownTool,
    };
  }
  return _creReg;
}

async function _ensureToolExecutor() {
  if (!_toolExecutorRef) {
    const mod = await import('../executor/tool-executor.js');
    _toolExecutorRef = mod.toolExecutor;
  }
  return _toolExecutorRef;
}

// ─── Manifest Validation ────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9-]+$/;
const DOMAIN_PATTERN = /^[a-z0-9_]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const VALID_TYPES = ['domain', 'utility', 'integration'];
// v121: Capability dotted notation (e.g. "tax.calculate", "vat.compute")
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Validate a specialist.json manifest.
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('id is required (string)');
  } else if (!ID_PATTERN.test(manifest.id)) {
    errors.push(`id must match ${ID_PATTERN} (got "${manifest.id}")`);
  } else if (manifest.id.length > 64) {
    errors.push('id max 64 characters');
  }

  if (!manifest.version || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push(`version must be semver X.Y.Z (got "${manifest.version}")`);
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('name is required (string)');
  }

  if (!manifest.domain || !DOMAIN_PATTERN.test(manifest.domain)) {
    errors.push(`domain must match ${DOMAIN_PATTERN} (got "${manifest.domain}")`);
  }

  if (manifest.type && !VALID_TYPES.includes(manifest.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (!manifest.engine || typeof manifest.engine !== 'string') {
    errors.push('engine version requirement is required');
  }

  if (!manifest.entry || typeof manifest.entry !== 'string') {
    errors.push('entry point is required');
  }

  if (manifest.migrations !== undefined) {
    if (!Array.isArray(manifest.migrations)) {
      errors.push('migrations must be an array');
    } else {
      for (const migrationName of manifest.migrations) {
        if (
          typeof migrationName !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(migrationName)
        ) {
          errors.push(`migration "${migrationName}" must be a package-local identifier`);
        }
      }
    }
  }

  // D7: Validate dependencies format
  if (manifest.dependencies) {
    if (typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) {
      errors.push('dependencies must be an object { id: ">=X.Y.Z" }');
    } else {
      for (const [depId, depVersion] of Object.entries(manifest.dependencies)) {
        if (!ID_PATTERN.test(depId)) {
          errors.push(`dependency id "${depId}" must match ${ID_PATTERN}`);
        }
        if (typeof depVersion !== 'string' || !depVersion.startsWith('>=')) {
          errors.push(`dependency "${depId}" version must be ">=X.Y.Z" format`);
        }
      }
    }
  }

  // v121: Manifest v2 fields (optional — v1 backwards compat)
  const manifestVersion = manifest.manifestVersion ?? 1;
  if (manifestVersion !== 1 && manifestVersion !== 2) {
    errors.push(`manifestVersion must be 1 or 2 (got ${manifestVersion})`);
  }

  // v121: Capabilities validation (only for v2)
  if (manifest.capabilities) {
    if (!Array.isArray(manifest.capabilities)) {
      errors.push('capabilities must be an array');
    } else {
      for (const cap of manifest.capabilities) {
        if (typeof cap !== 'string' || !CAPABILITY_PATTERN.test(cap)) {
          errors.push(`capability "${cap}" must match dotted notation (e.g. "tax.calculate")`);
        }
      }
    }
  }

  // v121: defaultExpertise path validation
  if (manifest.defaultExpertise && typeof manifest.defaultExpertise !== 'string') {
    errors.push('defaultExpertise must be a string path');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Simple semver satisfies check: manifest.engine ">=X.Y.Z" against current version.
 * Only supports >=X.Y.Z format for MVP.
 */
function checkEngineCompat(engineRequirement, currentVersion) {
  const match = engineRequirement.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    // Can't parse requirement — skip check, log warning
    return { compatible: true, warning: `Unparseable engine requirement: ${engineRequirement}` };
  }

  const required = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  const parts = currentVersion.split('.').map(Number);
  const current = [parts[0] || 0, parts[1] || 0, parts[2] || 0];

  for (let i = 0; i < 3; i++) {
    if (current[i] > required[i]) return { compatible: true };
    if (current[i] < required[i]) {
      return {
        compatible: false,
        error: `Requires engine >=${match[1]}.${match[2]}.${match[3]}, running ${currentVersion}`,
      };
    }
  }
  return { compatible: true }; // exact match
}

// ─── Specialist Loader ──────────────────────────────────────────────────────

export class SpecialistLoader {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {Object} runtime - SpecialistRuntime instance
   * @param {Object} [options]
   * @param {string} [options.baseDir] - specialists/ directory path
   * @param {string} [options.engineVersion] - current C3 engine version
   */
  constructor(db, runtime, options = {}) {
    this.db = db;
    this.runtime = runtime;

    // Default: project_root/specialists/
    const projectRoot = path.resolve(__dirname, '..', '..');
    this.baseDir = options.baseDir || path.join(projectRoot, 'specialists');
    this.engineVersion = options.engineVersion || _readPackageVersion();
    this.ToolAdapter = Object.hasOwn(options, 'ToolAdapter')
      ? options.ToolAdapter
      : ToolAdapter;

    /** @type {Map<string, { manifest: Object, dir: string }>} */
    this._discovered = new Map();

    /** @type {Map<string, Object>} loaded module references */
    this._modules = new Map();

    /** @type {Map<string, string>} canonical package root -> accepted tree digest */
    this._preflightDigests = new Map();

    /** @type {Set<string>} specialists needing ESM cache bust on next enable */
    this._needsCacheBust = new Set();

    /** @type {{ record: (event: string, payload: Object) => void }|null} v82: passive telemetry */
    this._telemetry = options.telemetry || null;

    this._prepareStatements();
  }

  _prepareStatements() {
    this._stmts = {
      getSpecialist: this.db.prepare(
        'SELECT * FROM specialists WHERE id = ?'
      ),
      listAll: this.db.prepare(
        'SELECT * FROM specialists ORDER BY id'
      ),
      listEnabled: this.db.prepare(
        "SELECT * FROM specialists WHERE status = 'enabled' ORDER BY id"
      ),
      insert: this.db.prepare(`
        INSERT INTO specialists (id, version, name, domain, type, status, manifest_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      updateStatus: this.db.prepare(`
        UPDATE specialists SET status = ?, enabled_at = ?, disabled_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `),
      updateVersion: this.db.prepare(`
        UPDATE specialists SET version = ?, manifest_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `),
      // Specialist migration tracking
      getMigrations: this.db.prepare(
        'SELECT migration_name FROM specialist_migrations WHERE specialist_id = ?'
      ),
      insertMigration: this.db.prepare(
        'INSERT INTO specialist_migrations (specialist_id, migration_name) VALUES (?, ?)'
      ),
    };
  }

  // ─── Phase 1: Discovery ─────────────────────────────────────────────────

  /**
   * Scan specialists/ directory for valid packages.
   * @returns {Object[]} Array of validated manifests
   */
  discoverAll() {
    this._discovered.clear();
    this._preflightDigests.clear();

    if (!fs.existsSync(this.baseDir)) {
      logger.debug('SpecialistLoader', `No specialists directory at ${this.baseDir}`);
      return [];
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new SpecialistPreflightError(
          'SPECIALIST_UNSAFE_TREE_ENTRY',
          `${entry.name} package is a symlink`,
        );
      }
      if (!entry.isDirectory()) continue;

      const dir = path.join(this.baseDir, entry.name);
      const manifestPath = path.join(dir, 'specialist.json');

      if (!fs.existsSync(manifestPath)) {
        logger.debug('SpecialistLoader', `Skipping ${entry.name}: no specialist.json`);
        continue;
      }

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw);

        // Validate
        const validation = validateManifest(manifest);
        if (!validation.valid) {
          logger.warn('SpecialistLoader', `Invalid manifest in ${entry.name}: ${validation.errors.join(', ')}`);
          continue;
        }

        // Check engine compatibility
        const compat = checkEngineCompat(manifest.engine, this.engineVersion);
        if (!compat.compatible) {
          logger.warn('SpecialistLoader', `Incompatible specialist ${manifest.id}: ${compat.error}`);
          continue;
        }
        if (compat.warning) {
          logger.debug('SpecialistLoader', compat.warning);
        }

        // Check entry point exists
        const entryPath = path.join(dir, manifest.entry);
        if (!fs.existsSync(entryPath)) {
          logger.warn('SpecialistLoader', `Missing entry point: ${entryPath}`);
          continue;
        }

        resolveSpecialistExecutable(dir, manifest.entry, `${manifest.id} entry point`);
        this._preflightPackage(dir);

        this._discovered.set(manifest.id, { manifest, dir });
        results.push(manifest);
        logger.debug('SpecialistLoader', `Discovered: ${manifest.id} v${manifest.version}`);
      } catch (err) {
        if (err instanceof SpecialistPreflightError) throw err;
        logger.warn('SpecialistLoader', `Error reading ${entry.name}: ${err.message}`);
      }
    }

    logger.info('SpecialistLoader', `Discovered ${results.length} specialist(s)`);
    return results;
  }

  // ─── Phase 2: Install Pending ───────────────────────────────────────────

  /**
   * Install newly discovered specialists (not yet in DB).
   * Runs specialist migrations and creates DB record.
   */
  installPending() {
    let installed = 0;

    for (const [id, { manifest, dir }] of this._discovered) {
      const existing = this._stmts.getSpecialist.get(id);

      if (existing) {
        // Already installed — check version update
        if (existing.version !== manifest.version) {
          logger.info('SpecialistLoader', `Updating ${id}: ${existing.version} → ${manifest.version}`);
          this._runMigrations(id, dir, manifest);
          this._stmts.updateVersion.run(manifest.version, JSON.stringify(manifest), id);
        }
        continue;
      }

      // New specialist — install
      logger.info('SpecialistLoader', `Installing: ${id} v${manifest.version}`);

      try {
        this._runMigrations(id, dir, manifest);

        const status = manifest.enabledByDefault ? 'enabled' : 'installed';
        this._stmts.insert.run(
          id,
          manifest.version,
          manifest.name,
          manifest.domain,
          manifest.type || 'domain',
          status,
          JSON.stringify(manifest),
        );
        installed++;
        logger.info('SpecialistLoader', `Installed: ${id} (status: ${status})`);
      } catch (err) {
        logger.error('SpecialistLoader', `Failed to install ${id}: ${err.message}`);
      }
    }

    if (installed > 0) {
      logger.info('SpecialistLoader', `${installed} new specialist(s) installed`);
    }
  }

  /**
   * Run specialist-scoped migrations.
   * Tracks in specialist_migrations table (separate from core schema_migrations).
   */
  _runMigrations(specialistId, dir, manifest) {
    if (!manifest.migrations?.length) return;

    const migrationsDir = path.join(dir, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn('SpecialistLoader', `Migrations declared but directory missing: ${migrationsDir}`);
      return;
    }

    const applied = new Set(
      this._stmts.getMigrations.all(specialistId).map(r => r.migration_name)
    );

    const pendingNames = [];
    for (const migrationName of manifest.migrations) {
      if (applied.has(migrationName)) continue;

      specialistMigrationRelativePath(migrationName);
      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);
      if (!fs.existsSync(migrationFile)) {
        logger.warn('SpecialistLoader', `Migration file not found: ${migrationFile}`);
        continue;
      }
      resolveSpecialistMigration(dir, migrationName);

      // Note: we can't use dynamic import synchronously inside a transaction.
      // So we collect pending migrations and run them sequentially.
      logger.info('SpecialistLoader', `Pending migration: ${specialistId}/${migrationName}`);
      pendingNames.push(migrationName);
    }

    // Actually run pending migrations (cannot be done inside the install transaction
    // because ESM import is async, but SQLite is sync — run one by one)
    this._pendingMigrations = this._pendingMigrations || [];
    for (const migrationName of pendingNames) {
      this._pendingMigrations.push({
        specialistId,
        packageDir: dir,
        migrationName,
      });
    }
  }

  /**
   * Execute pending migrations (async, called after sync installPending).
   */
  async _executePendingMigrations() {
    if (!this._pendingMigrations?.length) return;

    for (const { specialistId, packageDir, migrationName } of this._pendingMigrations) {
      try {
        this._preflightPackage(packageDir);
        const migrationFile = resolveSpecialistMigration(packageDir, migrationName);
        const mod = await import(migrationFile);
        if (typeof mod.up !== 'function') {
          logger.warn('SpecialistLoader', `Migration ${migrationName} has no up() function`);
          continue;
        }

        const runMigration = this.db.transaction(() => {
          mod.up(this.db);
          this._stmts.insertMigration.run(specialistId, migrationName);
        });

        runMigration();
        logger.info('SpecialistLoader', `Applied migration: ${specialistId}/${migrationName}`);
      } catch (err) {
        logger.error('SpecialistLoader', `Migration ${specialistId}/${migrationName} failed: ${err.message}`);
        throw err; // fail-fast
      }
    }

    this._pendingMigrations = [];
  }

  // ─── Phase 3: Enable ────────────────────────────────────────────────────

  /**
   * Enable all specialists with status 'enabled' in DB.
   * D7: Topological sort by dependencies — guarantees load order.
   * Loads index.js, calls register(), seeds knowledge.
   */
  async enableAll() {
    // First execute any pending migrations from installPending()
    await this._executePendingMigrations();

    const enabledRows = this._stmts.listEnabled.all();

    // D7: Sort by dependencies (Kahn's algorithm)
    const sorted = this._topologicalSort(enabledRows);

    let count = 0;
    for (const row of sorted) {
      const discovered = this._discovered.get(row.id);
      if (!discovered) {
        logger.warn('SpecialistLoader', `Specialist ${row.id} enabled in DB but not found on disk`);
        continue;
      }

      try {
        await this._enableOne(row.id, discovered);
        count++;
      } catch (err) {
        logger.error('SpecialistLoader', `Failed to enable ${row.id}: ${err.message}`);
      }
    }

    logger.info('SpecialistLoader', `${count} specialist(s) enabled`);
  }

  /**
   * Enable a single specialist.
   * Supports ESM cache busting for update flow.
   *
   * v121: Expanded ctx with registries for self-contained specialists.
   */
  async _enableOne(id, { manifest, dir }) {
    if (typeof this.ToolAdapter !== 'function') {
      throw new TypeError('SPECIALIST_TOOL_ADAPTER_REQUIRED');
    }

    const needsBust = this._needsCacheBust.has(id);

    if (this._modules.has(id) && !needsBust) {
      logger.debug('SpecialistLoader', `${id} already loaded, skipping`);
      return;
    }

    this._preflightPackage(dir);

    // Clear old module reference if cache busting
    if (needsBust) {
      this._modules.delete(id);
    }

    const entryPath = resolveSpecialistExecutable(
      dir,
      manifest.entry,
      `${id} entry point`,
    );
    let mod;
    if (needsBust) {
      // Cache bust: file URL with query param bypasses Node's ESM cache
      const url = pathToFileURL(entryPath);
      url.searchParams.set('v', Date.now());
      mod = await import(url.href);
      this._needsCacheBust.delete(id);
    } else {
      mod = await import(entryPath);
    }

    if (typeof mod.register !== 'function') {
      throw new Error(`${id}/index.js must export register(ctx)`);
    }

    // v121: Build expanded registration context with registries
    const [autoSelect, cre, toolExecutor] = await Promise.all([
      _ensureAutoSelect(),
      _ensureCRE(),
      _ensureToolExecutor(),
    ]);

    const ctx = {
      runtime: this.runtime,
      db: this.db,
      manifest,
      specialistDir: dir,
      logger: logger,
      ToolAdapter: this.ToolAdapter,

      // v121: Knowledge base (set via setKnowledgeBase)
      knowledgeBase: this._knowledgeBase || null,

      // v121: Registries — grouped namespace for specialist self-registration
      registries: {
        autoSelect,           // { registerBoostPatterns, unregisterBoostPatterns, getPatterns }
        scenario: this._scenarioRegistry || null,  // scenarioRegistry instance
        cre,                  // { registerToolType, unregisterToolType, isKnownTool }
        toolExecutor,         // CRE ToolExecutor singleton (register/unregister handlers)
        capability: this._capabilityRegistry || null, // v121 Krok 3
        expertise: this._expertiseRegistry || null,   // v121: expertiseRegistry (addCustom, removeCustom, get)
      },
    };

    // Call register — specialist wires itself into runtime + registries
    await mod.register(ctx);

    this._modules.set(id, mod);

    // v121 2c: Auto-load defaultExpertise from manifest
    if (manifest.defaultExpertise && this._expertiseRegistry) {
      try {
        const expertiseId = manifest.expertises?.[0] || id;
        const existing = this._expertiseRegistry.get(expertiseId);
        if (!existing) {
          const expPath = path.join(dir, manifest.defaultExpertise);
          if (fs.existsSync(expPath)) {
            const raw = fs.readFileSync(expPath, 'utf-8');
            const expConfig = JSON.parse(raw);
            this._expertiseRegistry.addCustom({ ...expConfig, isCustom: true });
            logger.debug('SpecialistLoader', `Auto-loaded expertise "${expertiseId}" from ${manifest.defaultExpertise}`);
          }
        }
      } catch (err) {
        logger.debug('SpecialistLoader', `defaultExpertise auto-load skipped for ${id}: ${err.message}`);
      }
    }

    // D5: Auto-seed expertise bindings from manifest
    this._seedExpertiseBindings(id, manifest);

    logger.info('SpecialistLoader', `Enabled: ${id} v${manifest.version}`);
  }

  /**
   * D5: Ensure specialist's manifest expertises are in the binding table.
   * Called on every enable — INSERT OR IGNORE makes it idempotent.
   * Manifest entries get priority=1 (favorite).
   */
  _seedExpertiseBindings(specialistId, manifest) {
    const expertises = manifest?.expertises;
    if (!expertises?.length) return;

    try {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO specialist_expertises (specialist_id, expertise_id, priority) VALUES (?, ?, ?)'
      );
      for (const expId of expertises) {
        insert.run(specialistId, expId, 1);
      }
      logger.debug('SpecialistLoader', `Seeded ${expertises.length} expertise binding(s) for ${specialistId}`);
    } catch (err) {
      // Non-fatal — table might not exist yet (migration not applied)
      logger.debug('SpecialistLoader', `Expertise seed skipped for ${specialistId}: ${err.message}`);
    }
  }

  // ─── Lifecycle API ──────────────────────────────────────────────────────

  /**
   * Enable a specific specialist by ID.
   * D7: Checks that all dependencies are enabled first.
   */
  async enable(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not found: ${specialistId}`);
    if (row.status === 'enabled') return; // noop

    const discovered = this._discovered.get(specialistId);
    if (!discovered) throw new Error(`Specialist ${specialistId} not on disk`);

    // D7: Check dependencies are enabled
    const manifest = discovered.manifest;
    if (manifest.dependencies) {
      const missing = this._checkDependencies(manifest.dependencies);
      if (missing.length > 0) {
        throw new Error(`Cannot enable ${specialistId}: missing/disabled dependencies: ${missing.join(', ')}`);
      }
    }

    await this._enableOne(specialistId, discovered);

    const now = new Date().toISOString();
    this._stmts.updateStatus.run('enabled', now, null, specialistId);

    // v82: Telemetry
    this._telemetry?.record('lifecycle.enable', { specialistId });
  }

  /**
   * Disable a specific specialist by ID.
   * D7: Refuses if other specialists depend on this one.
   * v121: Fail-safe cleanup of ALL registrations (tools, scenarios, boost, CRE, capabilities).
   */
  async disable(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not found: ${specialistId}`);
    if (row.status === 'disabled') return; // noop

    // D7: Check dependents — refuse if other specialists depend on this one
    const dependents = this.getDependents(specialistId);
    if (dependents.length > 0) {
      throw new Error(`Cannot disable ${specialistId}: required by: ${dependents.join(', ')}`);
    }

    const manifest = this._getManifestFromDiscovered(specialistId);
    const expertiseId = this._resolveExpertiseId(specialistId, manifest);

    // Let specialist do custom cleanup (v121: pass full ctx for fail-safe unregister)
    const mod = this._modules.get(specialistId);
    if (mod && typeof mod.unregister === 'function') {
      try {
        const [autoSelect, cre, toolExecutor] = await Promise.all([
          _ensureAutoSelect(),
          _ensureCRE(),
          _ensureToolExecutor(),
        ]);
        mod.unregister({
          runtime: this.runtime,
          manifest,
          ToolAdapter: this.ToolAdapter,
          registries: {
            autoSelect,
            scenario: this._scenarioRegistry || null,
            cre,
            toolExecutor,
            capability: this._capabilityRegistry || null,
            expertise: this._expertiseRegistry || null,
          },
        });
      } catch (err) {
        logger.warn('SpecialistLoader', `${specialistId} unregister() error: ${err.message}`);
      }
    }

    // v121: Fail-safe defensive cleanup — remove from ALL registries regardless of unregister()
    // Each step wrapped in try/catch to prevent ghost registrations.

    // Tools
    try {
      if (this.runtime.isSpecialist(expertiseId)) {
        this.runtime.unregisterSpecialist(expertiseId);
      }
    } catch (err) {
      logger.warn('SpecialistLoader', `${specialistId} tool cleanup error: ${err.message}`);
    }

    // Scenarios
    try { this._cleanupScenarios(expertiseId); } catch { /* noop */ }

    // v121: Boost patterns
    try {
      const autoSelect = await _ensureAutoSelect();
      autoSelect.unregisterBoostPatterns(expertiseId);
    } catch { /* noop */ }

    // v121: CRE tool types + tool executor handlers
    try {
      const cre = await _ensureCRE();
      const toolExec = await _ensureToolExecutor();
      const tools = manifest?.tools || [];
      for (const tool of tools) {
        cre.unregisterToolType(tool.id);
        toolExec.unregister(tool.id);
      }
    } catch { /* noop */ }

    // v121: Capabilities
    try {
      if (this._capabilityRegistry) {
        this._capabilityRegistry.unregisterBySpecialist(specialistId);
      }
    } catch { /* noop */ }

    // v121: Custom expertise
    try {
      if (this._expertiseRegistry) {
        this._expertiseRegistry.removeCustom(expertiseId);
      }
    } catch { /* noop */ }

    this._modules.delete(specialistId);

    const now = new Date().toISOString();
    this._stmts.updateStatus.run('disabled', null, now, specialistId);
    logger.info('SpecialistLoader', `Disabled: ${specialistId}`);

    // v82: Telemetry
    this._telemetry?.record('lifecycle.disable', { specialistId });
  }

  // ─── Update Flow ──────────────────────────────────────────────────────

  /**
   * Update a specialist to a new version discovered on disk.
   * Rollback-ready: DB version committed AFTER successful re-enable.
   * If re-enable fails, migrations are rolled back via down().
   *
   * Flow: validate → snapshot → disable → migrate → re-enable → commit DB.
   *
   * Requires discoverAll() to have been called first to pick up new manifest.
   *
   * @param {string} specialistId
   * @returns {Promise<{ oldVersion: string, newVersion: string, wasEnabled: boolean, reversible: boolean } | null>}
   */
  async update(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not installed: ${specialistId}`);

    const discovered = this._discovered.get(specialistId);
    if (!discovered) throw new Error(`Specialist ${specialistId} not found on disk (call discoverAll() first)`);

    const { manifest, dir } = discovered;
    const oldVersion = row.version;
    const newVersion = manifest.version;

    // Version must be strictly newer
    if (this._compareVersions(newVersion, oldVersion) <= 0) {
      logger.debug('SpecialistLoader', `${specialistId}: disk v${newVersion} <= installed v${oldVersion}, skipping`);
      return null;
    }

    // Validate manifest + engine
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid manifest for ${specialistId}: ${validation.errors.join(', ')}`);
    }
    const compat = checkEngineCompat(manifest.engine, this.engineVersion);
    if (!compat.compatible) {
      throw new Error(`Engine incompatible for ${specialistId}: ${compat.error}`);
    }

    const wasEnabled = row.status === 'enabled';
    const expertiseId = this._resolveExpertiseId(specialistId, manifest);

    // Safety: don't update while tools are executing
    if (wasEnabled && typeof this.runtime.isSpecialistBusy === 'function') {
      if (this.runtime.isSpecialistBusy(expertiseId)) {
        throw new Error(`Cannot update ${specialistId}: tools currently executing`);
      }
    }

    // Check migration reversibility
    const reversible = await this._checkMigrationsReversible(specialistId, dir, manifest);

    logger.info('SpecialistLoader', `Updating: ${specialistId} v${oldVersion} → v${newVersion}` +
      (reversible ? '' : ' (irreversible migrations)'));

    // 1. Snapshot pre-update state
    const snapshot = {
      oldVersion,
      oldManifest: row.manifest_json,
      oldStatus: row.status,
    };

    // 2. Clear tool module caches (before disable removes config)
    if (wasEnabled && typeof this.runtime.clearModuleCache === 'function') {
      this.runtime.clearModuleCache(expertiseId);
    }

    // 3. Disable if enabled
    if (wasEnabled) {
      await this.disable(specialistId);
    }

    // 4. Mark for entry point cache bust
    this._needsCacheBust.add(specialistId);

    // 5. Run new migrations
    const migrationsApplied = [];
    this._runMigrations(specialistId, dir, manifest);
    if (this._pendingMigrations?.length) {
      // Track which migrations we apply for potential rollback
      for (const pm of this._pendingMigrations) {
        migrationsApplied.push(pm.migrationName);
      }
    }
    await this._executePendingMigrations();

    // 6. Re-enable if was enabled — BEFORE DB version commit
    if (wasEnabled) {
      try {
        const now = new Date().toISOString();
        this._stmts.updateStatus.run('enabled', now, null, specialistId);
        await this._enableOne(specialistId, discovered);
      } catch (err) {
        // Re-enable failed — rollback migrations if reversible
        logger.error('SpecialistLoader', `Re-enable failed for ${specialistId}: ${err.message}`);

        if (reversible && migrationsApplied.length > 0) {
          await this._rollbackMigrations(specialistId, dir, manifest, migrationsApplied);
        }

        // Restore DB state to disabled (disable already set it, but status may have been changed)
        const nowFail = new Date().toISOString();
        this._stmts.updateStatus.run('disabled', null, nowFail, specialistId);
        this._needsCacheBust.delete(specialistId);

        throw new Error(`Update failed for ${specialistId}: re-enable failed after migration. ` +
          (reversible ? 'Migrations rolled back.' : 'Migrations NOT rolled back (irreversible).') +
          ` Original error: ${err.message}`);
      }
    }

    // 7. Commit DB version + manifest — ONLY after successful re-enable
    this._stmts.updateVersion.run(newVersion, JSON.stringify(manifest), specialistId);

    logger.info('SpecialistLoader', `Updated: ${specialistId} v${oldVersion} → v${newVersion}`);
    return { oldVersion, newVersion, wasEnabled, reversible };
  }

  /**
   * Check if all new migrations in a manifest have down() functions.
   * @returns {Promise<boolean>} true if all migrations are reversible
   */
  async _checkMigrationsReversible(specialistId, dir, manifest) {
    if (!manifest.migrations?.length) return true;

    const migrationsDir = path.join(dir, 'migrations');
    if (!fs.existsSync(migrationsDir)) return true;

    const applied = new Set(
      this._stmts.getMigrations.all(specialistId).map(r => r.migration_name)
    );

    this._preflightPackage(dir);

    for (const migrationName of manifest.migrations) {
      if (applied.has(migrationName)) continue;

      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);
      if (!fs.existsSync(migrationFile)) continue;

      try {
        const safeMigrationFile = resolveSpecialistMigration(dir, migrationName);
        const mod = await import(safeMigrationFile);
        if (typeof mod.down !== 'function') {
          logger.debug('SpecialistLoader', `Migration ${migrationName} has no down() — irreversible`);
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Rollback applied migrations in reverse order via their down() functions.
   */
  async _rollbackMigrations(specialistId, dir, manifest, migrationsApplied) {
    this._preflightPackage(dir);

    // Reverse order — last applied first
    for (let i = migrationsApplied.length - 1; i >= 0; i--) {
      const migrationName = migrationsApplied[i];

      try {
        const migrationFile = resolveSpecialistMigration(dir, migrationName);
        const mod = await import(migrationFile);
        if (typeof mod.down !== 'function') {
          logger.warn('SpecialistLoader', `Cannot rollback ${migrationName}: no down()`);
          continue;
        }

        const rollback = this.db.transaction(() => {
          mod.down(this.db);
          this.db.prepare(
            'DELETE FROM specialist_migrations WHERE specialist_id = ? AND migration_name = ?'
          ).run(specialistId, migrationName);
        });

        rollback();
        logger.info('SpecialistLoader', `Rolled back migration: ${specialistId}/${migrationName}`);
      } catch (err) {
        logger.error('SpecialistLoader', `Rollback failed for ${specialistId}/${migrationName}: ${err.message}`);
      }
    }
  }

  /**
   * Compare semver strings. Returns: 1 if a > b, -1 if a < b, 0 if equal.
   */
  _compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  /**
   * Resolve the expertise ID used in runtime from specialist ID.
   * accountant-cz manifest registers as 'accountant' in runtime.
   */
  _resolveExpertiseId(specialistId, manifest) {
    // Check if the specialist registered under a different expertise ID
    // by looking at manifest.expertises or the registered tools
    if (manifest?.expertises?.length) {
      return manifest.expertises[0]; // primary expertise ID
    }
    return specialistId;
  }

  _getManifestFromDiscovered(specialistId) {
    const discovered = this._discovered.get(specialistId);
    return discovered?.manifest || null;
  }

  /**
   * Remove scenarios registered by a specialist.
   */
  _cleanupScenarios(expertiseId) {
    try {
      // Lazy: only cleanup if scenario-engine is already loaded
      const scenarioMod = this._scenarioRegistry;
      if (scenarioMod && typeof scenarioMod.unregisterBySpecialist === 'function') {
        scenarioMod.unregisterBySpecialist(expertiseId);
      }
    } catch {
      // scenario-engine not loaded — nothing to clean
    }
  }

  /**
   * Set scenario registry reference for cleanup during disable.
   * @param {Object} registry - ScenarioRegistry instance
   */
  setScenarioRegistry(registry) {
    this._scenarioRegistry = registry;
  }

  /**
   * v121: Set knowledge base reference for specialist ctx.
   * @param {Object} kb - KnowledgeBase instance
   */
  setKnowledgeBase(kb) {
    this._knowledgeBase = kb;
  }

  /**
   * v121: Set capability registry reference for specialist ctx.
   * @param {Object} registry - CapabilityRegistry instance
   */
  setCapabilityRegistry(registry) {
    this._capabilityRegistry = registry;
  }

  /**
   * v121: Set expertise registry reference for specialist ctx.
   * @param {Object} registry - ExpertiseRegistry instance (addCustom, removeCustom, get)
   */
  setExpertiseRegistry(registry) {
    this._expertiseRegistry = registry;
  }

  _preflightPackage(packageDir) {
    let canonical;
    try {
      canonical = fs.realpathSync(packageDir);
    } catch (error) {
      throw new SpecialistPreflightError(
        'SPECIALIST_TREE_READ_FAILED',
        `package cannot be canonicalized: ${error.message}`,
      );
    }
    const acceptedDigest = this._preflightDigests.get(canonical) || null;
    const result = preflightSpecialistPackage(packageDir, acceptedDigest);
    this._preflightDigests.set(result.packageRoot, result.digest);
    return result.digest;
  }

  // ─── D7: Dependency System ──────────────────────────────────────────────

  /**
   * Topological sort of specialist rows by dependencies (Kahn's algorithm).
   * Specialists without dependencies come first.
   * Falls back to original order if cycle detected (shouldn't happen with valid manifests).
   * @param {Object[]} rows - DB rows with id field
   * @returns {Object[]} sorted rows
   */
  _topologicalSort(rows) {
    if (rows.length <= 1) return rows;

    const rowMap = new Map(rows.map(r => [r.id, r]));
    const inDegree = new Map(rows.map(r => [r.id, 0]));
    const adjacency = new Map(rows.map(r => [r.id, []]));

    // Build graph
    for (const row of rows) {
      const manifest = this._getManifestFromDiscovered(row.id);
      if (!manifest?.dependencies) continue;
      for (const depId of Object.keys(manifest.dependencies)) {
        if (rowMap.has(depId)) {
          // depId must load before row.id
          adjacency.get(depId).push(row.id);
          inDegree.set(row.id, (inDegree.get(row.id) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm — v121: alphabetical secondary sort for deterministic order
    const queue = rows.filter(r => inDegree.get(r.id) === 0)
      .map(r => r.id)
      .sort((a, b) => a.localeCompare(b));
    const sorted = [];

    while (queue.length > 0) {
      const id = queue.shift();
      sorted.push(rowMap.get(id));
      for (const neighbor of (adjacency.get(id) || [])) {
        const deg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          // v121: Insert in sorted position for deterministic order
          const idx = queue.findIndex(q => q.localeCompare(neighbor) > 0);
          if (idx === -1) queue.push(neighbor);
          else queue.splice(idx, 0, neighbor);
        }
      }
    }

    if (sorted.length < rows.length) {
      logger.warn('SpecialistLoader', 'Dependency cycle detected — using original order');
      return rows;
    }

    return sorted;
  }

  /**
   * Check that all dependencies are installed and enabled.
   * @param {Object} dependencies - { specialistId: ">=X.Y.Z" }
   * @returns {string[]} missing or disabled dependency IDs
   */
  _checkDependencies(dependencies) {
    const missing = [];
    for (const [depId, depVersion] of Object.entries(dependencies)) {
      const row = this._stmts.getSpecialist.get(depId);
      if (!row) {
        missing.push(`${depId} (not installed)`);
        continue;
      }
      if (row.status !== 'enabled') {
        missing.push(`${depId} (${row.status})`);
        continue;
      }
      // Version check (reuse checkEngineCompat)
      const compat = checkEngineCompat(depVersion, row.version);
      if (!compat.compatible) {
        missing.push(`${depId} (requires ${depVersion}, installed ${row.version})`);
      }
    }
    return missing;
  }

  /**
   * Get list of specialist IDs that depend on this specialist.
   * @param {string} specialistId
   * @returns {string[]} dependent specialist IDs
   */
  getDependents(specialistId) {
    const result = [];
    const installed = this._stmts.listAll.all();
    for (const row of installed) {
      if (row.id === specialistId) continue;
      try {
        const manifest = JSON.parse(row.manifest_json);
        if (manifest.dependencies && specialistId in manifest.dependencies) {
          result.push(row.id);
        }
      } catch {
        // Invalid manifest — skip
      }
    }
    return result;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /**
   * Get all installed specialists.
   */
  getInstalled() {
    return this._stmts.listAll.all();
  }

  /**
   * Get all enabled specialists.
   */
  getEnabled() {
    return this._stmts.listEnabled.all();
  }

  /**
   * Get manifest for a specialist.
   */
  getManifest(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) return null;
    try {
      return JSON.parse(row.manifest_json);
    } catch {
      return null;
    }
  }

  // ─── Integrity Check ─────────────────────────────────────────────────────

  /**
   * Verify runtime state matches DB state.
   * Returns { ok: boolean, issues: string[] }
   */
  checkIntegrity() {
    const issues = [];
    const enabledRows = this._stmts.listEnabled.all();

    for (const row of enabledRows) {
      const manifest = this._getManifestFromDiscovered(row.id);
      const expertiseId = this._resolveExpertiseId(row.id, manifest);

      // Check tools registered
      if (!this.runtime.isSpecialist(expertiseId)) {
        issues.push(`${row.id}: enabled in DB but NOT registered in runtime`);
      }

      // Check module loaded
      if (!this._modules.has(row.id)) {
        issues.push(`${row.id}: enabled in DB but module NOT loaded`);
      }
    }

    // Check for ghost registrations (in runtime but not in DB as enabled)
    const runtimeIds = this.runtime.getSpecialistIds();
    const enabledExpertiseIds = new Set(enabledRows.map(r => {
      const manifest = this._getManifestFromDiscovered(r.id);
      return this._resolveExpertiseId(r.id, manifest);
    }));

    for (const rid of runtimeIds) {
      if (!enabledExpertiseIds.has(rid)) {
        issues.push(`${rid}: registered in runtime but NOT enabled in DB (ghost)`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  // ─── Convenience: Full Boot ─────────────────────────────────────────────

  /**
   * Run the complete boot sequence: discover → install → enable.
   * Single call for server.js integration.
   */
  async boot() {
    const startTime = Date.now();
    this.discoverAll();
    this.installPending();
    await this.enableAll();

    // Post-boot integrity check
    const integrity = this.checkIntegrity();
    if (!integrity.ok) {
      for (const issue of integrity.issues) {
        logger.warn('SpecialistLoader', `Integrity: ${issue}`);
      }
    }

    // v82: Telemetry — passive, never throws
    this._telemetry?.record('lifecycle.boot', {
      durationMs: Date.now() - startTime,
      metadata: { enabled: this.getEnabled().length, total: this.getInstalled().length },
    });
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get or create the SpecialistLoader singleton.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} runtime - SpecialistRuntime instance
 * @param {Object} [options]
 * @returns {SpecialistLoader}
 */
export function getSpecialistLoader(db, runtime, options = {}) {
  if (!_instance) {
    if (!db) throw new Error('SpecialistLoader: db required on first call');
    if (!runtime) throw new Error('SpecialistLoader: runtime required on first call');
    _instance = new SpecialistLoader(db, runtime, options);
  }
  return _instance;
}

// v122: Loader accessor for post-skill reload (no args, returns null if not yet booted)
export function getLoader() {
  return _instance;
}

// v121: Test internals
export const _testLoaderInternals = { validateManifest, checkEngineCompat };

export default { SpecialistLoader, getSpecialistLoader };
