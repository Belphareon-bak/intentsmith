#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';

const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CLASSIFICATIONS = new Set(['CORE', 'OPTIONAL', 'UNRESOLVED']);
const MAP_KEYS = ['coreToOptional', 'graphSha256', 'rows', 'sourceRevision'];
const ROW_KEYS = ['classification', 'file', 'reason'];
const EDGE_KEYS = ['edge', 'inSameCycle'];
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

class ValidationFailure extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, message, exitCode = 1) {
  throw new ValidationFailure(code, message, exitCode);
}

function usage() {
  return [
    'Usage:',
    '  node scripts/validate-core-optional-map.mjs \\',
    '    --graph <absolute-module-graph.json> \\',
    '    --map <absolute-core-optional-map.json> \\',
    '    --source-revision <full-git-sha>',
    '',
    'Exit codes:',
    '  0  valid map',
    '  1  invalid graph or classification map',
    '  2  invocation, Git state, or artifact I/O failure',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--graph', '--map', '--source-revision'].includes(key)) {
      fail('USAGE', `unsupported argument: ${key || '<empty>'}`, 2);
    }
    if (value === undefined || value.startsWith('--')) {
      fail('USAGE', `missing value for ${key}`, 2);
    }
    if (values.has(key)) fail('USAGE', `duplicate argument: ${key}`, 2);
    values.set(key, value);
  }
  for (const key of ['--graph', '--map', '--source-revision']) {
    if (!values.has(key)) fail('USAGE', `missing required argument: ${key}`, 2);
  }
  const graphPath = values.get('--graph');
  const mapPath = values.get('--map');
  const sourceRevision = values.get('--source-revision');
  if (!isAbsolute(graphPath) || !isAbsolute(mapPath)) {
    fail('ARTIFACT_PATH_NOT_ABSOLUTE', 'graph and map paths must be absolute', 2);
  }
  if (resolve(graphPath) === resolve(mapPath)) {
    fail('ARTIFACT_PATH_COLLISION', 'graph and map must be distinct files', 2);
  }
  if (!SHA_PATTERN.test(sourceRevision)) {
    fail('SOURCE_REVISION_INVALID', 'source revision must be a full lowercase Git object ID', 2);
  }
  return { graphPath: resolve(graphPath), mapPath: resolve(mapPath), sourceRevision };
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    fail('GIT_COMMAND_FAILED', `${args.join(' ')}${detail ? `: ${detail}` : ''}`, 2);
  }
}

function repositoryRoot() {
  const cwd = realpathSync(process.cwd());
  const root = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']));
  if (cwd !== root) {
    fail('REPOSITORY_ROOT_REQUIRED', `run from repository root ${root}`, 2);
  }
  return root;
}

function assertRepositoryState(root, sourceRevision, phase) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (head !== sourceRevision) {
    fail('SOURCE_REVISION_MISMATCH', `${phase}: HEAD ${head} != ${sourceRevision}`, 2);
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') fail('WORKTREE_NOT_CLEAN', `${phase}: tracked or untracked changes exist`, 2);
}

function readArtifact(path, label) {
  let before;
  try {
    before = lstatSync(path, { bigint: true });
  } catch (error) {
    fail('ARTIFACT_READ_FAILED', `${label}: ${error.message}`, 2);
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    fail('ARTIFACT_NOT_REGULAR', `${label} must be a regular non-symlink file`, 2);
  }
  let canonical;
  try {
    canonical = realpathSync(path);
  } catch (error) {
    fail('ARTIFACT_REALPATH_FAILED', `${label}: ${error.message}`, 2);
  }
  if (canonical !== path) {
    fail('ARTIFACT_PATH_INDIRECT', `${label} path or parent resolves through a symlink`, 2);
  }
  if (before.size <= 0n || before.size > BigInt(MAX_ARTIFACT_BYTES)) {
    fail('ARTIFACT_SIZE_INVALID', `${label} must contain 1..${MAX_ARTIFACT_BYTES} bytes`, 2);
  }
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    fail('ARTIFACT_READ_FAILED', `${label}: ${error.message}`, 2);
  }
  const after = lstatSync(path, { bigint: true });
  for (const field of ['dev', 'ino', 'size', 'mtimeNs']) {
    if (before[field] !== after[field]) {
      fail('ARTIFACT_CHANGED_DURING_READ', `${label} changed while it was read`, 2);
    }
  }
  return bytes;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('JSON_UTF8_INVALID', `${label}: ${error.message}`);
  }
}

function assertNoDuplicateJsonKeys(text, label) {
  let offset = 0;

  function skipWhitespace() {
    while (/\s/u.test(text[offset] || '')) offset += 1;
  }

  function scanString() {
    if (text[offset] !== '"') fail('JSON_SYNTAX', `${label}: expected string`);
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === '\\') {
        offset += 2;
        continue;
      }
      if (text[offset] === '"') {
        offset += 1;
        const raw = text.slice(start, offset);
        try {
          return JSON.parse(raw);
        } catch (error) {
          fail('JSON_SYNTAX', `${label}: ${error.message}`);
        }
      }
      offset += 1;
    }
    fail('JSON_SYNTAX', `${label}: unterminated string`);
  }

  function scanValue() {
    skipWhitespace();
    if (text[offset] === '{') return scanObject();
    if (text[offset] === '[') return scanArray();
    if (text[offset] === '"') {
      scanString();
      return;
    }
    const start = offset;
    while (offset < text.length && !/[\s,\]}]/u.test(text[offset])) offset += 1;
    if (start === offset) fail('JSON_SYNTAX', `${label}: missing value`);
  }

  function scanObject() {
    offset += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      skipWhitespace();
      const key = scanString();
      if (keys.has(key)) fail('JSON_DUPLICATE_KEY', `${label}: duplicate key ${key}`);
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ':') fail('JSON_SYNTAX', `${label}: expected colon`);
      offset += 1;
      scanValue();
      skipWhitespace();
      if (text[offset] === '}') {
        offset += 1;
        return;
      }
      if (text[offset] !== ',') fail('JSON_SYNTAX', `${label}: expected comma`);
      offset += 1;
    }
    fail('JSON_SYNTAX', `${label}: unterminated object`);
  }

  function scanArray() {
    offset += 1;
    skipWhitespace();
    if (text[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      scanValue();
      skipWhitespace();
      if (text[offset] === ']') {
        offset += 1;
        return;
      }
      if (text[offset] !== ',') fail('JSON_SYNTAX', `${label}: expected comma`);
      offset += 1;
    }
    fail('JSON_SYNTAX', `${label}: unterminated array`);
  }

  scanValue();
  skipWhitespace();
  if (offset !== text.length) fail('JSON_SYNTAX', `${label}: trailing content`);
}

function parseJson(bytes, label) {
  const text = decodeUtf8(bytes, label);
  assertNoDuplicateJsonKeys(text, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('JSON_SYNTAX', `${label}: ${error.message}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) fail('MAP_SCHEMA_INVALID', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('MAP_SCHEMA_INVALID', `${label} keys must be exactly ${wanted.join(',')}`);
  }
}

function assertSourcePath(value, label) {
  if (typeof value !== 'string' || !value.startsWith('src/') || value.includes('\\')) {
    fail('GRAPH_PATH_INVALID', `${label} must be a normalized src/** path`);
  }
  if (value.endsWith('/') || value.includes('//') || value.split('/').some(part => part === '.' || part === '..')) {
    fail('GRAPH_PATH_INVALID', `${label} must not contain empty or traversal segments`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    fail('GRAPH_PATH_INVALID', `${label} contains a control character`);
  }
  return value;
}

function parseEdge(value, label) {
  if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) {
    fail('GRAPH_EDGE_INVALID', `${label} must be one exact edge string`);
  }
  const separator = value.indexOf(' -> ');
  if (separator <= 0 || value.indexOf(' -> ', separator + 4) !== -1) {
    fail('GRAPH_EDGE_INVALID', `${label} must contain one from -> to separator`);
  }
  const from = assertSourcePath(value.slice(0, separator), `${label}.from`);
  let target = value.slice(separator + 4);
  const dynamic = target.endsWith(' (dynamic)');
  if (dynamic) target = target.slice(0, -10);
  const to = assertSourcePath(target, `${label}.to`);
  const canonical = `${from} -> ${to}${dynamic ? ' (dynamic)' : ''}`;
  if (canonical !== value || from === to) fail('GRAPH_EDGE_INVALID', `${label} is not canonical`);
  return { edge: canonical, from, to };
}

function validateGraph(graph) {
  if (!isRecord(graph)) fail('GRAPH_SCHEMA_INVALID', 'graph must be an object');
  if (!isRecord(graph.meta) || graph.meta.tool !== 'scripts/module-graph.mjs' || graph.meta.protocol !== 1) {
    fail('GRAPH_PROTOCOL_INVALID', 'graph must come from scripts/module-graph.mjs protocol 1');
  }
  if (!isRecord(graph.counts) || !Number.isInteger(graph.counts.srcFiles) || graph.counts.srcFiles < 0) {
    fail('GRAPH_COUNT_INVALID', 'counts.srcFiles must be a non-negative integer');
  }
  if (!Array.isArray(graph.fanIn)) fail('GRAPH_SCHEMA_INVALID', 'fanIn must be an array');
  const files = new Set();
  for (const [index, row] of graph.fanIn.entries()) {
    if (!isRecord(row)) fail('GRAPH_SCHEMA_INVALID', `fanIn[${index}] must be an object`);
    const file = assertSourcePath(row.file, `fanIn[${index}].file`);
    if (files.has(file)) fail('GRAPH_FILE_DUPLICATE', `duplicate fanIn file ${file}`);
    files.add(file);
  }
  if (files.size !== graph.counts.srcFiles) {
    fail('GRAPH_COUNT_MISMATCH', `counts.srcFiles=${graph.counts.srcFiles}, fanIn=${files.size}`);
  }
  if (!Array.isArray(graph.cycles)) fail('GRAPH_SCHEMA_INVALID', 'cycles must be an array');
  const cycleByFile = new Map();
  for (const [cycleIndex, cycle] of graph.cycles.entries()) {
    if (!Array.isArray(cycle) || cycle.length < 2) {
      fail('GRAPH_CYCLE_INVALID', `cycles[${cycleIndex}] must contain at least two files`);
    }
    const local = new Set();
    for (const [fileIndex, rawFile] of cycle.entries()) {
      const file = assertSourcePath(rawFile, `cycles[${cycleIndex}][${fileIndex}]`);
      if (!files.has(file)) fail('GRAPH_CYCLE_INVALID', `cycle references foreign file ${file}`);
      if (local.has(file) || cycleByFile.has(file)) {
        fail('GRAPH_CYCLE_INVALID', `cycle membership is duplicated for ${file}`);
      }
      local.add(file);
      cycleByFile.set(file, cycleIndex);
    }
  }
  if (!Array.isArray(graph.edges)) fail('GRAPH_SCHEMA_INVALID', 'edges must be an array');
  const edges = [];
  const edgeNames = new Set();
  for (const [index, rawEdge] of graph.edges.entries()) {
    const edge = parseEdge(rawEdge, `edges[${index}]`);
    if (!files.has(edge.from) || !files.has(edge.to)) {
      fail('GRAPH_EDGE_FOREIGN_FILE', `${edge.edge} references a file outside fanIn`);
    }
    if (edgeNames.has(edge.edge)) fail('GRAPH_EDGE_DUPLICATE', `duplicate edge ${edge.edge}`);
    edgeNames.add(edge.edge);
    edges.push(edge);
  }
  return { files, edges, cycleByFile };
}

function validateMap(map, graph, graphSha256, sourceRevision) {
  assertExactKeys(map, MAP_KEYS, 'map');
  if (map.sourceRevision !== sourceRevision) {
    fail('MAP_SOURCE_REVISION_MISMATCH', `map sourceRevision != ${sourceRevision}`);
  }
  if (!SHA256_PATTERN.test(map.graphSha256 || '') || map.graphSha256 !== graphSha256) {
    fail('GRAPH_DIGEST_MISMATCH', 'map graphSha256 does not bind the exact graph bytes');
  }
  if (!Array.isArray(map.rows)) fail('MAP_SCHEMA_INVALID', 'rows must be an array');
  const rows = new Map();
  for (const [index, row] of map.rows.entries()) {
    assertExactKeys(row, ROW_KEYS, `rows[${index}]`);
    const file = assertSourcePath(row.file, `rows[${index}].file`);
    if (rows.has(file)) fail('MAP_FILE_DUPLICATE', `duplicate map row ${file}`);
    if (!graph.files.has(file)) fail('MAP_FOREIGN_FILE', `map row references foreign file ${file}`);
    if (!CLASSIFICATIONS.has(row.classification)) {
      fail('MAP_CLASSIFICATION_INVALID', `${file} has unknown classification ${row.classification}`);
    }
    if (typeof row.reason !== 'string') fail('MAP_REASON_INVALID', `${file} reason must be a string`);
    if (row.classification !== 'CORE' && row.reason.trim() === '') {
      fail('MAP_REASON_REQUIRED', `${file} requires a non-empty R1 reason`);
    }
    rows.set(file, row);
  }
  if (map.rows.length !== graph.files.size) {
    fail('MAP_COUNT_MISMATCH', `rows=${map.rows.length}, graph files=${graph.files.size}`);
  }
  for (const file of graph.files) {
    if (!rows.has(file)) fail('MAP_FILE_MISSING', `missing map row ${file}`);
  }

  const expectedEdges = new Map();
  for (const edge of graph.edges) {
    if (rows.get(edge.from).classification !== 'CORE' || rows.get(edge.to).classification !== 'OPTIONAL') continue;
    expectedEdges.set(edge.edge, graph.cycleByFile.has(edge.from)
      && graph.cycleByFile.get(edge.from) === graph.cycleByFile.get(edge.to));
  }
  if (!Array.isArray(map.coreToOptional)) {
    fail('MAP_SCHEMA_INVALID', 'coreToOptional must be an array');
  }
  const actualEdges = new Map();
  for (const [index, row] of map.coreToOptional.entries()) {
    assertExactKeys(row, EDGE_KEYS, `coreToOptional[${index}]`);
    const edge = parseEdge(row.edge, `coreToOptional[${index}].edge`);
    if (typeof row.inSameCycle !== 'boolean') {
      fail('MAP_SCC_FLAG_INVALID', `${edge.edge} inSameCycle must be boolean`);
    }
    if (actualEdges.has(edge.edge)) fail('MAP_EDGE_DUPLICATE', `duplicate map edge ${edge.edge}`);
    actualEdges.set(edge.edge, row.inSameCycle);
  }
  for (const [edge, inSameCycle] of expectedEdges) {
    if (!actualEdges.has(edge)) fail('MAP_EDGE_MISSING', `missing CORE -> OPTIONAL edge ${edge}`);
    if (actualEdges.get(edge) !== inSameCycle) {
      fail('MAP_SCC_FLAG_MISMATCH', `${edge} inSameCycle must equal ${inSameCycle}`);
    }
  }
  for (const edge of actualEdges.keys()) {
    if (!expectedEdges.has(edge)) fail('MAP_EDGE_UNEXPECTED', `non-derived CORE -> OPTIONAL edge ${edge}`);
  }

  const counts = { CORE: 0, OPTIONAL: 0, UNRESOLVED: 0 };
  for (const row of rows.values()) counts[row.classification] += 1;
  const sameCycle = [...expectedEdges.values()].filter(Boolean).length;
  const unresolvedBoundary = graph.edges.filter(edge => (
    rows.get(edge.from).classification === 'UNRESOLVED'
    || rows.get(edge.to).classification === 'UNRESOLVED'
  )).length;
  return { counts, coreToOptional: expectedEdges.size, sameCycle, unresolvedBoundary };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertUnchanged(path, expected, label) {
  const current = readArtifact(path, label);
  if (!current.equals(expected)) fail('ARTIFACT_CHANGED_DURING_VALIDATION', `${label} bytes changed`, 2);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const root = repositoryRoot();
  assertRepositoryState(root, options.sourceRevision, 'before');
  if (dirname(options.graphPath) !== dirname(options.mapPath)) {
    fail('ARTIFACT_ROOT_MISMATCH', 'graph and map must share one artifact root', 2);
  }
  const graphBytes = readArtifact(options.graphPath, 'graph');
  const mapBytes = readArtifact(options.mapPath, 'map');
  const graph = validateGraph(parseJson(graphBytes, 'graph'));
  const result = validateMap(
    parseJson(mapBytes, 'map'),
    graph,
    sha256(graphBytes),
    options.sourceRevision,
  );
  assertUnchanged(options.graphPath, graphBytes, 'graph');
  assertUnchanged(options.mapPath, mapBytes, 'map');
  assertRepositoryState(root, options.sourceRevision, 'after');
  console.log([
    'CORE_OPTIONAL_MAP_VALID_PASS',
    `sourceRevision=${options.sourceRevision}`,
    `files=${graph.files.size}`,
    `core=${result.counts.CORE}`,
    `optional=${result.counts.OPTIONAL}`,
    `unresolved=${result.counts.UNRESOLVED}`,
    `coreToOptional=${result.coreToOptional}`,
    `sameCycle=${result.sameCycle}`,
    `unresolvedBoundary=${result.unresolvedBoundary}`,
  ].join(' '));
}

try {
  main();
} catch (error) {
  const code = error instanceof ValidationFailure ? error.code : 'INTERNAL_ERROR';
  const exitCode = error instanceof ValidationFailure ? error.exitCode : 2;
  console.error(`CORE_OPTIONAL_MAP_VALIDATION_FAIL code=${code} ${error.message}`);
  process.exitCode = exitCode;
}
