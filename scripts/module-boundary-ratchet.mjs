#!/usr/bin/env node

import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_BASELINE = 'tests/fixtures/module-boundary/baseline.json';
const SCANNER = 'docs/review/2026-08-07-module-graph.mjs';
const CODE_PATH = /^src\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs|cjs|jsx)$/;
const BASELINE_KEYS = Object.freeze([
  'authority',
  'edges',
  'limits',
  'note',
  'scanner',
  'schemaVersion',
  'sourceRevision',
]);
const LIMIT_KEYS = Object.freeze(['cycles', 'filesInCycles']);
const SCANNER_LIMITS = [
  'computed import() targets are not resolved',
  'template-literal content (including src/domains/scaffolds/**) is ignored',
  'HTML <script src> edges are not modeled',
].join('; ');

class RatchetInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RatchetInputError';
    this.code = code;
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertCodePath(value, field) {
  if (typeof value !== 'string' || !CODE_PATH.test(value)) {
    throw new RatchetInputError(
      'INVALID_EXACT_EDGE',
      `${field} must be an exact src/** code-file path; directory and glob exceptions are forbidden`,
    );
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new RatchetInputError('INVALID_EXACT_EDGE', `${field} contains a traversal segment`);
  }
}

function parseExactPair(value, field = 'edge') {
  if (typeof value !== 'string') {
    throw new RatchetInputError('INVALID_EXACT_EDGE', `${field} must be a string`);
  }
  const parts = value.split(' -> ');
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new RatchetInputError(
      'INVALID_EXACT_EDGE',
      `${field} must contain exactly one delimiter: "from -> to"`,
    );
  }
  assertCodePath(parts[0], `${field}.from`);
  assertCodePath(parts[1], `${field}.to`);
  return `${parts[0]} -> ${parts[1]}`;
}

function parseCurrentEdge(value, field) {
  if (typeof value !== 'string') {
    throw new RatchetInputError('INVALID_GRAPH', `${field} must be a string`);
  }
  const normalized = value.endsWith(' (dynamic)') ? value.slice(0, -' (dynamic)'.length) : value;
  try {
    return parseExactPair(normalized, field);
  } catch (error) {
    if (error instanceof RatchetInputError) {
      throw new RatchetInputError('INVALID_GRAPH', error.message);
    }
    throw error;
  }
}

function assertSortedUnique(values, field, errorCode) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) {
      throw new RatchetInputError(errorCode, `${field} contains duplicate edge ${values[index]}`);
    }
    if (values[index - 1] > values[index]) {
      throw new RatchetInputError(errorCode, `${field} must be sorted bytewise`);
    }
  }
}

function assertNonNegativeInteger(value, field, errorCode) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RatchetInputError(errorCode, `${field} must be a non-negative integer`);
  }
}

function readJson(path, errorCode) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new RatchetInputError(errorCode, `${path}: ${error.code || error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new RatchetInputError(errorCode, `${path}: ${error.message}`);
  }
}

function validateBaseline(value) {
  if (!exactKeys(value, BASELINE_KEYS)) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline keys must be exactly: ${BASELINE_KEYS.join(', ')}`);
  }
  if (value.schemaVersion !== 1) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.schemaVersion must equal 1');
  }
  if (!['branch-local', 'integration'].includes(value.authority)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.authority must be branch-local or integration');
  }
  if (!/^[0-9a-f]{40}$/.test(value.sourceRevision)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.sourceRevision must be a full lowercase Git SHA');
  }
  if (value.scanner !== SCANNER) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline.scanner must equal ${SCANNER}`);
  }
  if (value.note !== SCANNER_LIMITS) {
    throw new RatchetInputError(
      'INVALID_BASELINE',
      'baseline.note must preserve the exact P6 scanner limitation notice',
    );
  }
  if (!exactKeys(value.limits, LIMIT_KEYS)) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline.limits keys must be exactly: ${LIMIT_KEYS.join(', ')}`);
  }
  assertNonNegativeInteger(value.limits.cycles, 'baseline.limits.cycles', 'INVALID_BASELINE');
  assertNonNegativeInteger(value.limits.filesInCycles, 'baseline.limits.filesInCycles', 'INVALID_BASELINE');
  if (value.limits.filesInCycles < value.limits.cycles * 2) {
    throw new RatchetInputError(
      'INVALID_BASELINE',
      'baseline.limits cannot describe the declared non-trivial cycles',
    );
  }
  if (!Array.isArray(value.edges)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.edges must be an array of exact pairs');
  }
  const edges = value.edges.map((edge, index) => parseExactPair(edge, `baseline.edges[${index}]`));
  assertSortedUnique(edges, 'baseline.edges', 'INVALID_BASELINE');
  return { ...value, edges };
}

function validateGraph(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RatchetInputError('INVALID_GRAPH', 'graph must be a JSON object');
  }
  if (!Array.isArray(value.edges)) {
    throw new RatchetInputError('INVALID_GRAPH', 'graph.edges must be an array');
  }
  if (!value.counts || typeof value.counts !== 'object' || Array.isArray(value.counts)) {
    throw new RatchetInputError('INVALID_GRAPH', 'graph.counts must be an object');
  }
  assertNonNegativeInteger(value.counts.cycles, 'graph.counts.cycles', 'INVALID_GRAPH');
  assertNonNegativeInteger(value.counts.filesInCycles, 'graph.counts.filesInCycles', 'INVALID_GRAPH');
  const edges = value.edges.map((edge, index) => parseCurrentEdge(edge, `graph.edges[${index}]`)).sort();
  assertSortedUnique(edges, 'graph.edges', 'INVALID_GRAPH');
  return {
    edges,
    cycles: value.counts.cycles,
    filesInCycles: value.counts.filesInCycles,
  };
}

function compare(baseline, graph) {
  const baselineSet = new Set(baseline.edges);
  const graphSet = new Set(graph.edges);
  const added = graph.edges.filter((edge) => !baselineSet.has(edge));
  const removed = baseline.edges.filter((edge) => !graphSet.has(edge));
  const cycleGrowth = graph.cycles > baseline.limits.cycles;
  const cycleMembershipGrowth = graph.filesInCycles > baseline.limits.filesInCycles;
  return {
    added,
    removed,
    cycleGrowth,
    cycleMembershipGrowth,
    pass: added.length === 0 && !cycleGrowth && !cycleMembershipGrowth,
  };
}

function parseArgs(argv) {
  const result = { root: DEFAULT_ROOT, baseline: null, graph: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--root', '--baseline', '--graph'].includes(arg)) {
      throw new RatchetInputError('INVALID_ARGUMENT', `unsupported argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new RatchetInputError('INVALID_ARGUMENT', `${arg} requires a value`);
    }
    result[arg.slice(2)] = value;
    index += 1;
  }
  result.root = resolve(result.root);
  result.baseline = resolve(result.root, result.baseline || DEFAULT_BASELINE);
  if (result.graph) result.graph = resolve(result.root, result.graph);
  return result;
}

function scanGraph(root) {
  const ownedTempDir = mkdtempSync(join(tmpdir(), 'intentsmith-module-boundary-ratchet-'));
  const graphPath = join(ownedTempDir, 'graph.json');
  try {
    const scannerPath = resolve(root, SCANNER);
    const child = spawnSync(process.execPath, [scannerPath, root, '--out', graphPath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env },
    });
    if (child.error || child.status !== 0) {
      const detail = child.error?.message || child.stderr?.trim() || `exit ${child.status}`;
      throw new RatchetInputError('SCANNER_FAILED', detail);
    }
    return readJson(graphPath, 'INVALID_GRAPH');
  } finally {
    rmSync(ownedTempDir, { recursive: true, force: true });
  }
}

function printResult(baseline, graph, result) {
  const headline = [
    `baselineEdges=${baseline.edges.length}`,
    `currentEdges=${graph.edges.length}`,
    `added=${result.added.length}`,
    `removed=${result.removed.length}`,
    `cycles=${graph.cycles}`,
    `filesInCycles=${graph.filesInCycles}`,
    `baselineAuthority=${baseline.authority}`,
    `baselineRevision=${baseline.sourceRevision}`,
  ].join(' ');

  console.log(`${result.pass ? 'MODULE_BOUNDARY_RATCHET_PASS' : 'MODULE_BOUNDARY_RATCHET_FAIL'} ${headline}`);
  console.log(`P6_SCANNER_LIMITS ${SCANNER_LIMITS}`);
  for (const edge of result.added) console.log(`ADDED ${edge}`);
  for (const edge of result.removed) console.log(`REMOVED ${edge}`);
  if (result.removed.length > 0) {
    console.log(`BASELINE_TIGHTENING_AVAILABLE removedEdges=${result.removed.length}; integrator decision required`);
  }
  if (graph.cycles < baseline.limits.cycles || graph.filesInCycles < baseline.limits.filesInCycles) {
    console.log(
      `CYCLE_BASELINE_TIGHTENING_AVAILABLE cycles=${baseline.limits.cycles}->${graph.cycles} `
      + `filesInCycles=${baseline.limits.filesInCycles}->${graph.filesInCycles}; integrator decision required`,
    );
  }
  if (result.cycleGrowth) {
    console.log(`CYCLE_COUNT_GREW baseline=${baseline.limits.cycles} current=${graph.cycles}`);
  }
  if (result.cycleMembershipGrowth) {
    console.log(
      `FILES_IN_CYCLES_GREW baseline=${baseline.limits.filesInCycles} current=${graph.filesInCycles}`,
    );
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const baseline = validateBaseline(readJson(options.baseline, 'INVALID_BASELINE'));
    const graphRaw = options.graph ? readJson(options.graph, 'INVALID_GRAPH') : scanGraph(options.root);
    const graph = validateGraph(graphRaw);
    const result = compare(baseline, graph);
    printResult(baseline, graph, result);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    const code = error instanceof RatchetInputError ? error.code : 'UNEXPECTED_ERROR';
    console.error(`MODULE_BOUNDARY_RATCHET_ERROR ${code}: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
