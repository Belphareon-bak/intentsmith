#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_RELATIVE = 'scripts/specialist-boundary-ratchet.mjs';
const BASELINE_RELATIVE = 'tests/fixtures/specialist-boundary/baseline.json';
const SPECIALISTS_RELATIVE = 'specialists';
const SCHEMA_VERSION = 1;
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CODE_LIKE_EXTENSIONS = new Set([
  '.jsx', '.ts', '.tsx', '.mts', '.cts', '.coffee', '.wasm',
]);
const BASELINE_KEYS = Object.freeze([
  'exceptions',
  'scannerBlob',
  'schemaVersion',
  'sourceRevision',
  'specialistsTree',
]);
const EXCEPTION_KEYS = Object.freeze([
  'count',
  'expiresOnIntegration',
  'from',
  'kind',
  'owner',
  'to',
]);
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SAFE_FROM = /^specialists\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs|cjs)$/u;
const SAFE_TO = /^src\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs|cjs)$/u;
const USAGE = `Usage:
  node ${SCRIPT_RELATIVE} [--root PATH]
  node ${SCRIPT_RELATIVE} --require-clean [--root PATH]
  node ${SCRIPT_RELATIVE} --write-baseline [--root PATH]
    --accept-reference "runtime|specialists/from.js -> src/to.js|1"...
    --owner WP-ID --expires-on-integration WP-ID
  node ${SCRIPT_RELATIVE} --write-baseline --expire-owner WP-ID
    [--root PATH]

Exit codes:
  0  boundary accepted or baseline written
  1  boundary/policy drift
  2  invalid input, unreadable/unsafe tree, parse failure, or Git provenance error`;

class BoundaryError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = 'BoundaryError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function normalizePath(value) {
  return value.split(sep).join('/');
}

function isInside(parent, child) {
  const delta = relative(parent, child);
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`));
}

function assertInside(parent, child, code, label) {
  if (!isInside(parent, child)) {
    throw new BoundaryError(code, `${label} escapes ${parent}: ${child}`);
  }
}

function runGit(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new BoundaryError('GIT_EXECUTION_FAILED', result.error.message);
  }
  if (!allowFailure && result.status !== 0) {
    throw new BoundaryError(
      'GIT_COMMAND_FAILED',
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    accepted: [],
    owner: null,
    expiresOnIntegration: null,
    expireOwner: null,
    writeBaseline: false,
    requireClean: false,
    help: false,
  };
  const once = new Set();
  const take = (index, flag) => {
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new BoundaryError('INVALID_ARGUMENT', `${flag} requires one value`);
    }
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--write-baseline') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.writeBaseline = true;
    } else if (arg === '--require-clean') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.requireClean = true;
    } else if (arg === '--root') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.root = resolve(take(index, arg));
      index += 1;
    } else if (arg === '--accept-reference') {
      options.accepted.push(take(index, arg));
      index += 1;
    } else if (arg === '--owner') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.owner = take(index, arg);
      index += 1;
    } else if (arg === '--expires-on-integration') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.expiresOnIntegration = take(index, arg);
      index += 1;
    } else if (arg === '--expire-owner') {
      if (once.has(arg)) throw new BoundaryError('INVALID_ARGUMENT', `${arg} may appear only once`);
      once.add(arg);
      options.expireOwner = take(index, arg);
      index += 1;
    } else {
      throw new BoundaryError('INVALID_ARGUMENT', `unsupported argument: ${arg}`);
    }
  }

  options.root = realpathDirectory(options.root, 'repository root');
  options.baseline = resolve(options.root, BASELINE_RELATIVE);
  assertInside(options.root, options.baseline, 'INVALID_BASELINE_TARGET', 'baseline');

  if (options.requireClean && options.writeBaseline) {
    throw new BoundaryError('INVALID_ARGUMENT', '--require-clean and --write-baseline are mutually exclusive');
  }
  if (!options.writeBaseline && (
    options.accepted.length > 0
    || options.owner
    || options.expiresOnIntegration
    || options.expireOwner
  )) {
    throw new BoundaryError('INVALID_ARGUMENT', 'write-only arguments require --write-baseline');
  }
  if (options.writeBaseline && options.expireOwner) {
    if (options.accepted.length > 0 || options.owner || options.expiresOnIntegration) {
      throw new BoundaryError(
        'INVALID_ARGUMENT',
        '--expire-owner cannot be combined with acceptance or bootstrap owner arguments',
      );
    }
  } else if (options.writeBaseline && (
    options.accepted.length === 0
    || !options.owner
    || !options.expiresOnIntegration
  )) {
    throw new BoundaryError(
      'INVALID_ARGUMENT',
      'bootstrap writer requires acceptance references, --owner, and --expires-on-integration',
    );
  }
  return options;
}

function realpathDirectory(target, label) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    throw new BoundaryError('TREE_READ_FAILED', `${label} is unreadable: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new BoundaryError('UNSAFE_TREE_ENTRY', `${label} must be a non-symlink directory`);
  }
  try {
    return realpathSync(target);
  } catch (error) {
    throw new BoundaryError('TREE_READ_FAILED', `${label} cannot be canonicalized: ${error.message}`);
  }
}

function readRegularFile(target, label) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    throw new BoundaryError('TREE_READ_FAILED', `${label} cannot be inspected: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new BoundaryError('UNSAFE_TREE_ENTRY', `${label} must be a regular non-symlink file`);
  }
  if ((stat.mode & 0o444) === 0) {
    throw new BoundaryError('TREE_READ_FAILED', `${label} has no readable permission bit`);
  }
  try {
    return { buffer: readFileSync(target), stat };
  } catch (error) {
    throw new BoundaryError('TREE_READ_FAILED', `${label} cannot be read: ${error.message}`);
  }
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new BoundaryError('SOURCE_DECODE_FAILED', `${label} is not valid UTF-8: ${error.message}`);
  }
}

function syntaxCheck(file, root) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new BoundaryError(
      'SOURCE_PARSE_FAILED',
      `${normalizePath(relative(root, file))}: ${result.error?.message || result.stderr.trim() || 'syntax check failed'}`,
    );
  }
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/u.test(char || '');
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/u.test(char || '');
}

function regexCanStart(previous) {
  if (!previous) return true;
  if (previous.type === 'punct') return /[({[=,:;!?&|+\-*%^~<>]/u.test(previous.value);
  return previous.type === 'identifier'
    && new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'yield', 'await', 'else', 'do']).has(previous.value);
}

function tokenize(source, label) {
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
      if (end === -1) throw new BoundaryError('SOURCE_PARSE_FAILED', `${label}: unterminated block comment`);
      index = end + 2;
      push({ type: 'comment', kind: jsdoc ? 'jsdoc' : 'block', value: source.slice(start, index), start });
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
      if (source[index - 1] !== quote) throw new BoundaryError('SOURCE_PARSE_FAILED', `${label}: unterminated string`);
      push({
        type: 'string',
        value: source.slice(start + 1, index - 1),
        raw: source.slice(start, index),
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
      if (source[index - 1] !== '`') throw new BoundaryError('SOURCE_PARSE_FAILED', `${label}: unterminated template`);
      const value = source.slice(start, index);
      if (value.includes('${') && /\b(?:import|require)\b/u.test(value)) {
        throw new BoundaryError(
          'UNPROVEN_TEMPLATE_IMPORT',
          `${label}: template interpolation may not hide an import or require expression`,
        );
      }
      push({ type: 'template', value, start });
      continue;
    }
    if (char === '/' && regexCanStart(previous)) {
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
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
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

function stringValue(token, label) {
  if (token.escaped) {
    throw new BoundaryError(
      'UNSUPPORTED_ESCAPED_SPECIFIER',
      `${label}: escaped module specifiers are rejected instead of guessed`,
    );
  }
  return token.value;
}

function findClosingParen(tokens, openIndex, label) {
  return findClosingDelimiter(tokens, openIndex, '(', ')', label);
}

function findClosingDelimiter(tokens, openIndex, open, close, label) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new BoundaryError('SOURCE_PARSE_FAILED', `${label}: unmatched ${open}${close} delimiter`);
}

function resolveInternalTarget(root, file, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const clean = specifier.split(/[?#]/u, 1)[0];
  const lexical = resolve(dirname(file), clean);
  const candidates = [
    lexical,
    ...[...EXECUTABLE_EXTENSIONS].map((extension) => `${lexical}${extension}`),
    ...[...EXECUTABLE_EXTENSIONS].map((extension) => join(lexical, `index${extension}`)),
  ];
  let selected = null;
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        selected = realpathSync(candidate);
        break;
      }
    } catch {
      // A missing candidate is normal while applying Node-style extension resolution.
    }
  }
  const srcRoot = resolve(root, 'src');
  const pointsIntoSrc = isInside(srcRoot, lexical) || (selected && isInside(srcRoot, selected));
  if (!pointsIntoSrc) return null;
  const target = selected || lexical;
  const relativeTarget = normalizePath(relative(root, target));
  if (!SAFE_TO.test(relativeTarget)) {
    throw new BoundaryError(
      'UNRESOLVED_INTERNAL_REFERENCE',
      `${normalizePath(relative(root, file))}: internal specifier ${specifier} does not resolve to an exact src code file`,
    );
  }
  return relativeTarget;
}

function proveComputedPackageLocal({ root, packageRoot, file, tokens, computedImportIndexes }) {
  const from = normalizePath(relative(root, file));
  const isIdentifier = (index, value) => (
    tokens[index]?.type === 'identifier' && tokens[index].value === value
  );
  const isValue = (index, value) => tokens[index]?.value === value;
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
      && stringValue(tokens[index + 8], from) === 'tools'
      && isValue(index + 9, ')');
    if (!exact) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: toolsDir has a non-canonical assignment`);
    }
    anchors.push(index);
  }
  if (anchors.length !== 1) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: computed import lacks the exact toolsDir anchor`);
  }
  const definitions = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      isIdentifier(index, 'function')
      && isIdentifier(index + 1, 'buildToolDefinitions')
      && isValue(index + 2, '(')
      && isIdentifier(index + 3, 'toolsDir')
      && isValue(index + 4, ')')
    ) {
      if (!isValue(index + 5, '{')) {
        throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: buildToolDefinitions must have a block body`);
      }
      definitions.push({
        index,
        bodyOpen: index + 5,
        bodyClose: findClosingDelimiter(tokens, index + 5, '{', '}', from),
      });
    }
  }
  if (definitions.length !== 1) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: exact buildToolDefinitions(toolsDir) is required`);
  }
  const calls = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'buildToolDefinitions') || !isValue(index + 1, '(')) continue;
    const close = findClosingParen(tokens, index + 1, from);
    const args = tokens.slice(index + 2, close);
    if (args.length !== 1 || args[0].type !== 'identifier' || args[0].value !== 'toolsDir') {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: every tool definition call must use only toolsDir`);
    }
    calls.push(index);
  }
  if (calls.length < 2) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: every tool definition call must use only toolsDir`);
  }
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
    if (!exact) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: every modulePath must use a literal package-local .js filename`);
    }
    const filename = stringValue(tokens[index + 8], from);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(filename)) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: every modulePath must use a literal package-local .js filename`);
    }
    if (index <= definitions[0].bodyOpen || index >= definitions[0].bodyClose) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: modulePath must be defined inside buildToolDefinitions`);
    }
    modulePathDefinitions.add(index);
    filenames.push(filename);
  }
  if (filenames.length === 0) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: every modulePath must use a literal package-local .js filename`);
  }
  const toolsBindings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'tools') || !isValue(index + 1, '=')) continue;
    const exact = isIdentifier(index - 1, 'const')
      && isIdentifier(index + 2, 'buildToolDefinitions')
      && isValue(index + 3, '(')
      && isIdentifier(index + 4, 'toolsDir')
      && isValue(index + 5, ')');
    if (!exact) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: tools must come only from buildToolDefinitions(toolsDir)`);
    }
    toolsBindings.push(index);
  }
  if (toolsBindings.length !== 1) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: exactly one canonical tools binding is required`);
  }

  const canonicalLoops = [];
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
    canonicalLoops.push({
      index,
      bodyOpen: index + 7,
      bodyClose: findClosingDelimiter(tokens, index + 7, '{', '}', from),
    });
  }
  if (canonicalLoops.length !== 1 || toolsBindings[0] >= canonicalLoops[0].index) {
    throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: exact for (const tool of tools) loader loop is required`);
  }
  for (let index = toolsBindings[0] + 1; index < canonicalLoops[0].index; index += 1) {
    if (isIdentifier(index, 'tools')) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: tools may not escape or mutate before the loader loop`);
    }
  }
  for (let index = canonicalLoops[0].bodyOpen + 1; index < canonicalLoops[0].bodyClose; index += 1) {
    if (isIdentifier(index, 'tool') && !isValue(index + 1, '.')) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: tool may not be rebound inside the loader loop`);
    }
    if (isIdentifier(index, 'tools') && !isValue(index - 1, '.')) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: tools may not be referenced inside the loader loop`);
    }
  }
  for (const index of computedImportIndexes) {
    if (index <= canonicalLoops[0].bodyOpen || index >= canonicalLoops[0].bodyClose) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: computed import is outside the canonical loader loop`);
    }
  }

  const computedModulePaths = new Set(computedImportIndexes.map((index) => index + 4));
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(index, 'modulePath')) continue;
    if (!modulePathDefinitions.has(index) && !computedModulePaths.has(index)) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: modulePath use is outside the proven definition/import shape`);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const directMutation = isIdentifier(index, 'modulePath') && isValue(index + 1, '=');
    const dottedMutation = isValue(index, '.') && isIdentifier(index + 1, 'modulePath') && isValue(index + 2, '=');
    const bracketMutation = tokens[index]?.type === 'string'
      && tokens[index].value === 'modulePath'
      && isValue(index - 1, '[')
      && isValue(index + 1, ']')
      && isValue(index + 2, '=');
    const deleteMutation = isIdentifier(index, 'delete')
      && tokens.slice(index + 1, index + 7).some((token) => token.value === 'modulePath');
    if (directMutation || dottedMutation || bracketMutation || deleteMutation) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: modulePath mutation is forbidden`);
    }
  }
  const toolsRoot = realpathDirectory(join(packageRoot, 'tools'), `${from} tools directory`);
  for (const filename of filenames) {
    const target = join(toolsRoot, filename);
    const { stat } = readRegularFile(target, `${from} computed target ${filename}`);
    if (!stat.isFile()) {
      throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: ${filename} is not a regular file`);
    }
    const canonical = realpathSync(target);
    assertInside(toolsRoot, canonical, 'UNPROVEN_COMPUTED_IMPORT', `${from} computed target`);
  }
}

function analyzeSource({ root, packageRoot, file, source }) {
  const from = normalizePath(relative(root, file));
  if (!SAFE_FROM.test(from)) {
    throw new BoundaryError('INVALID_SOURCE_PATH', `unsupported specialist source path: ${from}`);
  }
  const allTokens = tokenize(source, from);
  const comments = allTokens.filter((token) => token.type === 'comment');
  const tokens = allTokens.filter((token) => token.type !== 'comment');
  const occurrences = [];
  const computedImportIndexes = [];
  const add = (kind, specifier) => {
    const to = resolveInternalTarget(root, file, specifier);
    if (to) occurrences.push({ kind, from, to });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (!next) throw new BoundaryError('SOURCE_PARSE_FAILED', `${from}: incomplete import`);
      if (next.value === '.') continue;
      if (next.value === '(') {
        const close = findClosingParen(tokens, index + 1, from);
        const args = tokens.slice(index + 2, close);
        if (args.length === 1 && args[0].type === 'string') {
          add('runtime', stringValue(args[0], from));
        } else if (
          args.length === 3
          && args[0].type === 'identifier' && args[0].value === 'tool'
          && args[1].value === '.'
          && args[2].type === 'identifier' && args[2].value === 'modulePath'
        ) {
          computedImportIndexes.push(index);
        } else {
          throw new BoundaryError('UNPROVEN_COMPUTED_IMPORT', `${from}: computed import target is not statically package-local`);
        }
        index = close;
      } else if (next.type === 'string') {
        add('runtime', stringValue(next, from));
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
          throw new BoundaryError('SOURCE_PARSE_FAILED', `${from}: static import has no literal source`);
        }
        add('runtime', stringValue(found, from));
      }
    } else if (token.value === 'export') {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].value === ';') break;
        if (tokens[cursor].type === 'identifier' && tokens[cursor].value === 'from') {
          const specifier = tokens[cursor + 1];
          if (!specifier || specifier.type !== 'string') {
            throw new BoundaryError('SOURCE_PARSE_FAILED', `${from}: re-export has no literal source`);
          }
          add('runtime', stringValue(specifier, from));
          break;
        }
      }
    } else if (token.value === 'require') {
      if (tokens[index + 1]?.value !== '(') {
        throw new BoundaryError('UNPROVEN_COMPUTED_REQUIRE', `${from}: aliased or indirect require is forbidden`);
      }
      const close = findClosingParen(tokens, index + 1, from);
      const args = tokens.slice(index + 2, close);
      if (args.length !== 1 || args[0].type !== 'string') {
        throw new BoundaryError('UNPROVEN_COMPUTED_REQUIRE', `${from}: computed require target is forbidden`);
      }
      add('runtime', stringValue(args[0], from));
      index = close;
    } else if (['eval', 'Function', 'createRequire'].includes(token.value)) {
      throw new BoundaryError(
        'UNPROVEN_DYNAMIC_CODE',
        `${from}: ${token.value} can hide an indirect module load and is forbidden`,
      );
    }
  }

  for (const comment of comments.filter((entry) => entry.kind === 'jsdoc')) {
    const matchedRanges = [];
    const regex = /\bimport\s*\(\s*(['"])([^'"\\]+)\1\s*\)/gu;
    let match;
    while ((match = regex.exec(comment.value))) {
      matchedRanges.push([match.index, regex.lastIndex]);
      add('jsdoc', match[2]);
    }
    const scrubbed = [...comment.value].map((char, charIndex) => (
      matchedRanges.some(([start, end]) => charIndex >= start && charIndex < end) ? ' ' : char
    )).join('');
    if (/\bimport\s*\(/u.test(scrubbed)) {
      throw new BoundaryError('UNPROVEN_JSDOC_IMPORT', `${from}: computed or escaped JSDoc import is forbidden`);
    }
  }

  if (computedImportIndexes.length > 0) {
    proveComputedPackageLocal({ root, packageRoot, file, tokens, computedImportIndexes });
  }
  return occurrences;
}

function discoverAndScan(root) {
  const specialists = resolve(root, SPECIALISTS_RELATIVE);
  const specialistsCanonical = realpathDirectory(specialists, SPECIALISTS_RELATIVE);
  const packages = [];
  const files = [];

  let rootEntries;
  try {
    rootEntries = readdirSync(specialists, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    throw new BoundaryError('TREE_READ_FAILED', `cannot enumerate specialists: ${error.message}`);
  }
  for (const entry of rootEntries) {
    const target = join(specialists, entry.name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new BoundaryError('UNSAFE_TREE_ENTRY', `specialists/${entry.name} is a symlink`);
    }
    if (stat.isDirectory()) packages.push(target);
    else if (stat.isFile()) {
      const { buffer } = readRegularFile(target, `specialists/${entry.name}`);
      if (
        EXECUTABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())
        || CODE_LIKE_EXTENSIONS.has(extname(entry.name).toLowerCase())
        || (stat.mode & 0o111) !== 0
        || buffer.subarray(0, 2).toString() === '#!'
      ) {
        throw new BoundaryError('UNSCOPED_EXECUTABLE', `executable source must belong to a specialist package: specialists/${entry.name}`);
      }
    } else {
      throw new BoundaryError('UNSAFE_TREE_ENTRY', `unsupported specialists root entry: ${entry.name}`);
    }
  }
  if (packages.length === 0) throw new BoundaryError('EMPTY_SPECIALIST_TREE', 'no specialist packages discovered');

  const walk = (directory, packageRoot) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      throw new BoundaryError('TREE_READ_FAILED', `${normalizePath(relative(root, directory))}: ${error.message}`);
    }
    for (const entry of entries) {
      const target = join(directory, entry.name);
      let stat;
      try {
        stat = lstatSync(target);
      } catch (error) {
        throw new BoundaryError('TREE_READ_FAILED', `${normalizePath(relative(root, target))}: ${error.message}`);
      }
      if (stat.isSymbolicLink()) {
        throw new BoundaryError('UNSAFE_TREE_ENTRY', `${normalizePath(relative(root, target))} is a symlink`);
      }
      if (stat.isDirectory()) {
        const canonical = realpathSync(target);
        assertInside(specialistsCanonical, canonical, 'PATH_ESCAPE', normalizePath(relative(root, target)));
        walk(target, packageRoot);
        continue;
      }
      if (!stat.isFile()) {
        throw new BoundaryError('UNSAFE_TREE_ENTRY', `${normalizePath(relative(root, target))} is not a regular file`);
      }
      const label = normalizePath(relative(root, target));
      const { buffer } = readRegularFile(target, label);
      const extension = extname(entry.name).toLowerCase();
      if (EXECUTABLE_EXTENSIONS.has(extension)) {
        files.push({ file: target, packageRoot, source: decodeUtf8(buffer, label) });
      } else if (
        CODE_LIKE_EXTENSIONS.has(extension)
        || (stat.mode & 0o111) !== 0
        || buffer.subarray(0, 2).toString() === '#!'
      ) {
        throw new BoundaryError('UNKNOWN_EXECUTABLE_EXTENSION', `${label}: executable extension is not .js/.mjs/.cjs`);
      }
    }
  };
  for (const packageRoot of packages) walk(packageRoot, packageRoot);
  files.sort((left, right) => left.file.localeCompare(right.file));

  const occurrences = [];
  for (const entry of files) {
    syntaxCheck(entry.file, root);
    occurrences.push(...analyzeSource({ root, ...entry }));
  }
  const grouped = new Map();
  for (const occurrence of occurrences) {
    const key = `${occurrence.kind}|${occurrence.from}|${occurrence.to}`;
    const current = grouped.get(key) || { ...occurrence, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  return {
    packages: packages.length,
    files: files.length,
    references: occurrences.length,
    groups: [...grouped.values()].sort(compareReferences),
  };
}

function compareReferences(left, right) {
  return left.kind.localeCompare(right.kind)
    || left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to);
}

function referenceKey(reference) {
  return `${reference.kind}|${reference.from} -> ${reference.to}|${reference.count}`;
}

function validateReferenceShape(reference, label, { baseline = false } = {}) {
  const expected = baseline ? EXCEPTION_KEYS : ['count', 'from', 'kind', 'to'];
  if (!exactKeys(reference, expected)) {
    throw new BoundaryError('INVALID_REFERENCE', `${label} keys must be exactly ${expected.join(', ')}`);
  }
  if (!['runtime', 'jsdoc'].includes(reference.kind)) {
    throw new BoundaryError('INVALID_REFERENCE', `${label}.kind must be runtime or jsdoc`);
  }
  if (!SAFE_FROM.test(reference.from) || !SAFE_TO.test(reference.to)) {
    throw new BoundaryError('INVALID_REFERENCE', `${label} must contain exact specialist/src code-file paths`);
  }
  if (!Number.isInteger(reference.count) || reference.count <= 0) {
    throw new BoundaryError('INVALID_REFERENCE', `${label}.count must be a positive integer`);
  }
  if (baseline) {
    for (const key of ['owner', 'expiresOnIntegration']) {
      if (typeof reference[key] !== 'string' || !/^WP-[A-Z0-9-]+$/u.test(reference[key])) {
        throw new BoundaryError('INVALID_REFERENCE', `${label}.${key} must be a concrete WP id`);
      }
    }
  }
}

function readJson(target, code) {
  const { buffer } = readRegularFile(target, normalizePath(target));
  try {
    return JSON.parse(decodeUtf8(buffer, target));
  } catch (error) {
    if (error instanceof BoundaryError) throw error;
    throw new BoundaryError(code, `${target}: ${error.message}`);
  }
}

function validateBaseline(value) {
  if (!exactKeys(value, BASELINE_KEYS)) {
    throw new BoundaryError('INVALID_BASELINE', `baseline keys must be exactly ${BASELINE_KEYS.join(', ')}`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new BoundaryError('INVALID_BASELINE', `baseline.schemaVersion must equal ${SCHEMA_VERSION}`);
  }
  for (const key of ['sourceRevision', 'specialistsTree', 'scannerBlob']) {
    if (typeof value[key] !== 'string' || !OBJECT_ID.test(value[key])) {
      throw new BoundaryError('INVALID_BASELINE', `baseline.${key} must be a full lowercase Git object id`);
    }
  }
  if (!Array.isArray(value.exceptions)) {
    throw new BoundaryError('INVALID_BASELINE', 'baseline.exceptions must be an array');
  }
  const exceptions = value.exceptions.map((entry, index) => {
    validateReferenceShape(entry, `baseline.exceptions[${index}]`, { baseline: true });
    return { ...entry };
  });
  const sorted = [...exceptions].sort(compareReferences);
  if (exceptions.some((entry, index) => referenceKey(entry) !== referenceKey(sorted[index]))) {
    throw new BoundaryError('INVALID_BASELINE', 'baseline.exceptions must be deterministically sorted');
  }
  const keys = exceptions.map(referenceKey);
  if (new Set(keys).size !== keys.length) {
    throw new BoundaryError('INVALID_BASELINE', 'baseline.exceptions contains a duplicate reference');
  }
  return { ...value, exceptions };
}

function baselineRelative(root, baseline) {
  const value = normalizePath(relative(root, baseline));
  if (!value || value.startsWith('../')) {
    throw new BoundaryError('INVALID_BASELINE_TARGET', 'baseline must be inside repository root');
  }
  return value;
}

function assertTrackedBlob(root, revision, path, expectedMode = '100644') {
  const result = runGit(root, ['ls-tree', revision, '--', path]);
  const fields = result.stdout.trim().split(/\s+/u);
  if (fields.length !== 4 || fields[0] !== expectedMode || fields[1] !== 'blob') {
    throw new BoundaryError('INVALID_PROVENANCE', `${revision}:${path} must be one ${expectedMode} blob`);
  }
  return fields[2];
}

function verifyBaselineProvenance(root, baselinePath, baseline) {
  const path = baselineRelative(root, baselinePath);
  runGit(root, ['cat-file', '-e', `${baseline.sourceRevision}^{commit}`]);
  const ancestor = runGit(root, ['merge-base', '--is-ancestor', baseline.sourceRevision, 'HEAD'], { allowFailure: true });
  if (ancestor.status !== 0) {
    throw new BoundaryError('STALE_PROVENANCE', 'baseline.sourceRevision is not an ancestor of HEAD');
  }
  const sourceTree = runGit(root, ['rev-parse', `${baseline.sourceRevision}:${SPECIALISTS_RELATIVE}`]).stdout.trim();
  const sourceScanner = runGit(root, ['rev-parse', `${baseline.sourceRevision}:${SCRIPT_RELATIVE}`]).stdout.trim();
  if (sourceTree !== baseline.specialistsTree || sourceScanner !== baseline.scannerBlob) {
    throw new BoundaryError('STALE_PROVENANCE', 'baseline tree/scanner does not match sourceRevision');
  }
  const currentTree = runGit(root, ['rev-parse', `HEAD:${SPECIALISTS_RELATIVE}`]).stdout.trim();
  const currentScanner = runGit(root, ['rev-parse', `HEAD:${SCRIPT_RELATIVE}`]).stdout.trim();
  if (currentTree !== baseline.specialistsTree || currentScanner !== baseline.scannerBlob) {
    throw new BoundaryError('STALE_PROVENANCE', 'current specialist tree or scanner differs from the baseline provenance');
  }
  const currentBlob = assertTrackedBlob(root, 'HEAD', path);
  const worktreeBlob = runGit(root, ['hash-object', '--', path]).stdout.trim();
  if (currentBlob !== worktreeBlob) {
    throw new BoundaryError('STALE_PROVENANCE', 'baseline worktree bytes differ from HEAD');
  }
  const dirty = runGit(root, [
    'status', '--porcelain=v1', '--untracked-files=all', '--',
    SPECIALISTS_RELATIVE, SCRIPT_RELATIVE, path,
  ]).stdout.trim();
  if (dirty) {
    throw new BoundaryError('STALE_PROVENANCE', `relevant worktree path is dirty: ${dirty.split('\n')[0]}`);
  }

  const history = runGit(root, ['rev-list', '--parents', 'HEAD']).stdout.trim().split('\n').filter(Boolean);
  const issuers = [];
  for (const line of history) {
    const [commit, ...parents] = line.split(' ');
    if (parents.length !== 1 || parents[0] !== baseline.sourceRevision) continue;
    const changed = runGit(root, ['diff', '--no-renames', '--name-only', baseline.sourceRevision, commit]).stdout.trim();
    if (changed !== path) continue;
    const blob = runGit(root, ['rev-parse', `${commit}:${path}`], { allowFailure: true });
    if (blob.status === 0 && blob.stdout.trim() === currentBlob) issuers.push(commit);
  }
  if (issuers.length !== 1) {
    throw new BoundaryError(
      'INVALID_BASELINE_ISSUANCE',
      `baseline must come from exactly one direct report-only child of sourceRevision; found ${issuers.length}`,
    );
  }
  return { sourceRevision: baseline.sourceRevision, issuanceRevision: issuers[0] };
}

function parseAccepted(value, index) {
  const parts = value.split('|');
  if (parts.length !== 3) {
    throw new BoundaryError('INVALID_ACCEPTANCE', `acceptance[${index}] must have kind|from -> to|count`);
  }
  const [kind, pair, countText] = parts;
  const pairParts = pair.split(' -> ');
  const reference = {
    kind,
    from: pairParts[0],
    to: pairParts.length === 2 ? pairParts[1] : '',
    count: Number(countText),
  };
  validateReferenceShape(reference, `acceptance[${index}]`);
  return reference;
}

function assertWriteEnvironment(root, baseline) {
  const gitRoot = runGit(root, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (realpathSync(gitRoot) !== root) {
    throw new BoundaryError('BASELINE_WRITE_REQUIRES_GIT', 'root must be the exact Git worktree root');
  }
  const status = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (status) {
    throw new BoundaryError('BASELINE_WRITE_DIRTY_TREE', `writer requires a clean tree: ${status.split('\n')[0]}`);
  }
  const parent = dirname(baseline);
  realpathDirectory(parent, 'baseline parent');
  if (existsSync(baseline)) readRegularFile(baseline, 'baseline write target');
  return {
    sourceRevision: runGit(root, ['rev-parse', 'HEAD']).stdout.trim(),
    specialistsTree: runGit(root, ['rev-parse', `HEAD:${SPECIALISTS_RELATIVE}`]).stdout.trim(),
    scannerBlob: runGit(root, ['rev-parse', `HEAD:${SCRIPT_RELATIVE}`]).stdout.trim(),
  };
}

function assertStableWriteEnvironment(root, baseline, before) {
  const after = assertWriteEnvironment(root, baseline);
  for (const key of ['sourceRevision', 'specialistsTree', 'scannerBlob']) {
    if (before[key] !== after[key]) {
      throw new BoundaryError('BASELINE_WRITE_SOURCE_CHANGED', `${key} changed during measurement`);
    }
  }
}

function atomicWriteJson(target, value) {
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o644);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
    const parentDescriptor = openSync(dirname(target), 'r');
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function compareExpected(actual, expected) {
  const actualMap = new Map(actual.map((entry) => [referenceKey(entry), entry]));
  const expectedMap = new Map(expected.map((entry) => [referenceKey(entry), entry]));
  return {
    added: [...actualMap.keys()].filter((key) => !expectedMap.has(key)).sort(),
    removed: [...expectedMap.keys()].filter((key) => !actualMap.has(key)).sort(),
  };
}

function printReferences(groups, exceptions = []) {
  const owners = new Map(exceptions.map((entry) => [referenceKey(entry), entry]));
  for (const entry of groups) {
    const owner = owners.get(referenceKey(entry));
    console.log(
      `REFERENCE kind=${entry.kind} from=${entry.from} to=${entry.to} count=${entry.count}`
      + (owner ? ` owner=${owner.owner} expiresOnIntegration=${owner.expiresOnIntegration}` : ''),
    );
  }
}

function writeBaseline(options) {
  const source = assertWriteEnvironment(options.root, options.baseline);
  const scan = discoverAndScan(options.root);
  assertStableWriteEnvironment(options.root, options.baseline, source);
  let exceptions;
  if (options.expireOwner) {
    const current = validateBaseline(readJson(options.baseline, 'INVALID_BASELINE'));
    if (current.exceptions.length === 0 || current.exceptions.some((entry) => entry.owner !== options.expireOwner)) {
      throw new BoundaryError('OWNER_EXPIRY_MISMATCH', `all existing exceptions must belong to ${options.expireOwner}`, 1);
    }
    if (scan.references !== 0) {
      printReferences(scan.groups);
      throw new BoundaryError('OWNER_EXPIRY_VIOLATIONS_REMAIN', 'cannot expire owner while references remain', 1);
    }
    exceptions = [];
  } else {
    const accepted = options.accepted.map(parseAccepted).sort(compareReferences);
    if (new Set(accepted.map(referenceKey)).size !== accepted.length) {
      throw new BoundaryError('INVALID_ACCEPTANCE', 'duplicate acceptance reference');
    }
    const delta = compareExpected(scan.groups, accepted);
    if (delta.added.length > 0 || delta.removed.length > 0) {
      for (const key of delta.added) console.error(`ACCEPTANCE_REQUIRED ${key}`);
      for (const key of delta.removed) console.error(`UNEXPECTED_ACCEPTANCE ${key}`);
      throw new BoundaryError('EXACT_ACCEPTANCE_REQUIRED', 'accept every and only current references', 1);
    }
    exceptions = accepted.map((entry) => ({
      from: entry.from,
      to: entry.to,
      kind: entry.kind,
      count: entry.count,
      owner: options.owner,
      expiresOnIntegration: options.expiresOnIntegration,
    })).sort(compareReferences);
  }
  atomicWriteJson(options.baseline, {
    schemaVersion: SCHEMA_VERSION,
    sourceRevision: source.sourceRevision,
    specialistsTree: source.specialistsTree,
    scannerBlob: source.scannerBlob,
    exceptions,
  });
  console.log(
    `SPECIALIST_BOUNDARY_BASELINE_WRITTEN path=${baselineRelative(options.root, options.baseline)}`
    + ` sourceRevision=${source.sourceRevision} packages=${scan.packages}`
    + ` files=${scan.files} references=${scan.references} exceptions=${exceptions.length}`,
  );
  return 0;
}

function runRequireClean(options) {
  const scan = discoverAndScan(options.root);
  if (scan.references !== 0) {
    console.error(
      `SPECIALIST_BOUNDARY_CLEAN_FAIL packages=${scan.packages} files=${scan.files}`
      + ` references=${scan.references}`,
    );
    printReferences(scan.groups);
    return 1;
  }
  console.log(
    `SPECIALIST_BOUNDARY_CLEAN_PASS packages=${scan.packages} files=${scan.files} references=0`,
  );
  return 0;
}

function runNormal(options) {
  const baseline = validateBaseline(readJson(options.baseline, 'INVALID_BASELINE'));
  const scan = discoverAndScan(options.root);
  const delta = compareExpected(scan.groups, baseline.exceptions);
  if (delta.added.length > 0 || delta.removed.length > 0) {
    console.error(
      `SPECIALIST_BOUNDARY_RATCHET_FAIL packages=${scan.packages} files=${scan.files}`
      + ` references=${scan.references} exceptions=${baseline.exceptions.length}`,
    );
    for (const key of delta.added) console.error(`ADDED ${key}`);
    for (const key of delta.removed) console.error(`REMOVED_OR_COUNT_CHANGED ${key}`);
    printReferences(scan.groups, baseline.exceptions);
    return 1;
  }
  const provenance = verifyBaselineProvenance(options.root, options.baseline, baseline);
  console.log(
    `SPECIALIST_BOUNDARY_RATCHET_PASS packages=${scan.packages} files=${scan.files}`
    + ` references=${scan.references} exceptions=${baseline.exceptions.length}`
    + ` baselineRevision=${baseline.sourceRevision} issuanceRevision=${provenance.issuanceRevision}`,
  );
  printReferences(scan.groups, baseline.exceptions);
  return 0;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    if (options.writeBaseline) return writeBaseline(options);
    if (options.requireClean) return runRequireClean(options);
    return runNormal(options);
  } catch (error) {
    const boundary = error instanceof BoundaryError
      ? error
      : new BoundaryError('UNEXPECTED_ERROR', error.stack || error.message);
    console.error(`SPECIALIST_BOUNDARY_RATCHET_ERROR ${boundary.code}: ${boundary.message}`);
    return boundary.exitCode;
  }
}

process.exitCode = main();
