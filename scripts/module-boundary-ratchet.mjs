#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_BASELINE = 'tests/fixtures/module-boundary/baseline.json';
const SCANNER = 'scripts/module-graph.mjs';
const LEGACY_SCANNER = 'docs/review/2026-08-07-module-graph.mjs';
const SCANNER_PROTOCOL = 1;
const CODE_PATH = /^src\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:[cm]?[jt]s|[jt]sx)$/;
const LEGACY_BASELINE_KEYS = Object.freeze([
  'authority',
  'edges',
  'limits',
  'note',
  'scanner',
  'schemaVersion',
  'sourceRevision',
]);
const BASELINE_KEYS = Object.freeze([
  'authority',
  'edges',
  'limits',
  'scanner',
  'scannerBlob',
  'scannerProtocol',
  'schemaVersion',
  'sourceRevision',
  'sourceTree',
]);
const LIMIT_KEYS = Object.freeze(['cycles', 'filesInCycles']);
const LEGACY_SCANNER_LIMITS = [
  'computed import() targets are not resolved',
  'template-literal content (including src/domains/scaffolds/**) is ignored',
  'HTML <script src> edges are not modeled',
].join('; ');
const GIT_OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const USAGE = `Usage:
  node scripts/module-boundary-ratchet.mjs [--root PATH] [--baseline PATH] [--graph PATH]
  node scripts/module-boundary-ratchet.mjs --write-baseline [--root PATH] [--baseline PATH]
    [--accept-edge "src/from.js -> src/to.js"]...

Exit codes:
  0  graph accepted or baseline written
  1  boundary drift or unaccepted baseline change
  2  invalid input, scanner failure, Git/provenance failure, or tool defect`;

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

function validateLimits(value) {
  if (!exactKeys(value, LIMIT_KEYS)) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline.limits keys must be exactly: ${LIMIT_KEYS.join(', ')}`);
  }
  assertNonNegativeInteger(value.cycles, 'baseline.limits.cycles', 'INVALID_BASELINE');
  assertNonNegativeInteger(value.filesInCycles, 'baseline.limits.filesInCycles', 'INVALID_BASELINE');
}

function validateBaselineEdges(value) {
  if (!Array.isArray(value)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.edges must be an array of exact pairs');
  }
  const edges = value.map((edge, index) => parseExactPair(edge, `baseline.edges[${index}]`));
  assertSortedUnique(edges, 'baseline.edges', 'INVALID_BASELINE');
  return edges;
}

function validateBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline must be a JSON object');
  }

  if (value.schemaVersion === 1) {
    if (!exactKeys(value, LEGACY_BASELINE_KEYS)) {
      throw new RatchetInputError(
        'INVALID_BASELINE',
        `legacy baseline keys must be exactly: ${LEGACY_BASELINE_KEYS.join(', ')}`,
      );
    }
    if (!['branch-local', 'integration'].includes(value.authority)) {
      throw new RatchetInputError('INVALID_BASELINE', 'baseline.authority must be branch-local or integration');
    }
    if (!/^[0-9a-f]{40}$/.test(value.sourceRevision)) {
      throw new RatchetInputError('INVALID_BASELINE', 'baseline.sourceRevision must be a full lowercase Git SHA');
    }
    if (value.scanner !== LEGACY_SCANNER) {
      throw new RatchetInputError('INVALID_BASELINE', `legacy baseline.scanner must equal ${LEGACY_SCANNER}`);
    }
    if (value.note !== LEGACY_SCANNER_LIMITS) {
      throw new RatchetInputError(
        'INVALID_BASELINE',
        'legacy baseline.note must preserve the exact P6 scanner limitation notice',
      );
    }
    validateLimits(value.limits);
    return {
      ...value,
      edges: validateBaselineEdges(value.edges),
      migrationAvailable: true,
    };
  }

  if (value.schemaVersion !== 2) {
    throw new RatchetInputError(
      'INVALID_BASELINE',
      'baseline.schemaVersion must equal 1 or 2; run --write-baseline to migrate schema 1',
    );
  }
  if (!exactKeys(value, BASELINE_KEYS)) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline keys must be exactly: ${BASELINE_KEYS.join(', ')}`);
  }
  if (value.authority !== 'integration') {
    throw new RatchetInputError('INVALID_BASELINE', 'schema 2 baseline.authority must equal integration');
  }
  if (!/^[0-9a-f]{40}$/.test(value.sourceRevision)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.sourceRevision must be a full lowercase Git SHA');
  }
  if (value.scanner !== SCANNER) {
    throw new RatchetInputError('INVALID_BASELINE', `baseline.scanner must equal ${SCANNER}`);
  }
  if (value.scannerProtocol !== SCANNER_PROTOCOL) {
    throw new RatchetInputError(
      'INVALID_BASELINE',
      `baseline.scannerProtocol must equal ${SCANNER_PROTOCOL}`,
    );
  }
  if (!GIT_OBJECT_ID.test(value.sourceTree)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.sourceTree must be a lowercase Git object id');
  }
  if (!GIT_OBJECT_ID.test(value.scannerBlob)) {
    throw new RatchetInputError('INVALID_BASELINE', 'baseline.scannerBlob must be a lowercase Git object id');
  }
  validateLimits(value.limits);
  return {
    ...value,
    edges: validateBaselineEdges(value.edges),
    migrationAvailable: false,
  };
}

function validateScannerMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RatchetInputError('INVALID_GRAPH', 'graph.meta must be an object');
  }
  if (value.tool !== SCANNER) {
    throw new RatchetInputError('INVALID_GRAPH', `graph.meta.tool must equal ${SCANNER}`);
  }
  if (value.protocol !== SCANNER_PROTOCOL) {
    throw new RatchetInputError('INVALID_GRAPH', `graph.meta.protocol must equal ${SCANNER_PROTOCOL}`);
  }
  if (!Array.isArray(value.limitations) || value.limitations.some((item) => (
    typeof item !== 'string' || item.length === 0
  ))) {
    throw new RatchetInputError('INVALID_GRAPH', 'graph.meta.limitations must be an array of non-empty strings');
  }
  return [...value.limitations];
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
  const normalizedEdges = value.edges.map((edge, index) => (
    parseCurrentEdge(edge, `graph.edges[${index}]`)
  ));
  const edges = [...new Set(normalizedEdges)].sort();
  return {
    edges,
    rawEdges: value.edges.length,
    normalizedDuplicates: normalizedEdges.length - edges.length,
    cycles: value.counts.cycles,
    filesInCycles: value.counts.filesInCycles,
    limitations: validateScannerMeta(value.meta),
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
  const result = {
    root: DEFAULT_ROOT,
    baseline: null,
    graph: null,
    writeBaseline: false,
    acceptedEdges: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      result.help = true;
      continue;
    }
    if (arg === '--write-baseline') {
      if (result.writeBaseline) {
        throw new RatchetInputError('INVALID_ARGUMENT', '--write-baseline may be provided only once');
      }
      result.writeBaseline = true;
      continue;
    }
    if (!['--root', '--baseline', '--graph', '--accept-edge'].includes(arg)) {
      throw new RatchetInputError('INVALID_ARGUMENT', `unsupported argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new RatchetInputError('INVALID_ARGUMENT', `${arg} requires a value`);
    }
    if (arg === '--accept-edge') result.acceptedEdges.push(value);
    else result[arg.slice(2)] = value;
    index += 1;
  }
  if (result.graph && result.writeBaseline) {
    throw new RatchetInputError('INVALID_ARGUMENT', '--write-baseline refuses synthetic --graph input');
  }
  if (!result.writeBaseline && result.acceptedEdges.length > 0) {
    throw new RatchetInputError('INVALID_ARGUMENT', '--accept-edge is valid only with --write-baseline');
  }
  result.root = resolve(result.root);
  result.baseline = resolve(result.root, result.baseline || DEFAULT_BASELINE);
  if (result.graph) result.graph = resolve(result.root, result.graph);
  result.acceptedEdges = result.acceptedEdges.map((edge, index) => (
    parseExactPair(edge, `--accept-edge[${index}]`)
  )).sort();
  assertSortedUnique(result.acceptedEdges, '--accept-edge', 'INVALID_ARGUMENT');
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

function runGit(root, args, { allowStatus = [] } = {}) {
  const child = spawnSync('git', ['-C', root, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (child.error) {
    throw new RatchetInputError('GIT_FAILED', child.error.message);
  }
  if (child.status !== 0 && !allowStatus.includes(child.status)) {
    const detail = child.stderr?.trim() || child.stdout?.trim() || `exit ${child.status}`;
    throw new RatchetInputError('GIT_FAILED', `git ${args.join(' ')}: ${detail}`);
  }
  return child;
}

function discoverGitRoot(root) {
  const child = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (child.error) {
    throw new RatchetInputError('GIT_FAILED', child.error.message);
  }
  if (child.status !== 0) return null;
  const gitRoot = child.stdout.trim();
  if (realpathSync(gitRoot) !== realpathSync(root)) {
    throw new RatchetInputError('GIT_ROOT_MISMATCH', `${root} is not the Git worktree root ${gitRoot}`);
  }
  return gitRoot;
}

function verifyBaselineProvenance(root, baseline) {
  if (baseline.schemaVersion === 1) {
    return { status: 'legacy-unverified', currentRevision: null, distance: null };
  }
  if (!discoverGitRoot(root)) {
    return { status: 'git-metadata-unavailable', currentRevision: null, distance: null };
  }

  const commit = runGit(root, ['cat-file', '-e', `${baseline.sourceRevision}^{commit}`], {
    allowStatus: [1, 128],
  });
  if (commit.status !== 0) {
    throw new RatchetInputError(
      'INVALID_BASELINE_PROVENANCE',
      `baseline.sourceRevision does not identify a local commit: ${baseline.sourceRevision}`,
    );
  }
  const ancestry = runGit(root, ['merge-base', '--is-ancestor', baseline.sourceRevision, 'HEAD'], {
    allowStatus: [1],
  });
  if (ancestry.status !== 0) {
    throw new RatchetInputError(
      'INVALID_BASELINE_PROVENANCE',
      `baseline.sourceRevision is not an ancestor of HEAD: ${baseline.sourceRevision}`,
    );
  }

  const sourceTree = runGit(root, ['rev-parse', `${baseline.sourceRevision}:src`]).stdout.trim();
  if (sourceTree !== baseline.sourceTree) {
    throw new RatchetInputError(
      'INVALID_BASELINE_PROVENANCE',
      `baseline.sourceTree ${baseline.sourceTree} does not match ${baseline.sourceRevision}:src ${sourceTree}`,
    );
  }
  const sourceScanner = runGit(root, ['rev-parse', `${baseline.sourceRevision}:${SCANNER}`]).stdout.trim();
  if (sourceScanner !== baseline.scannerBlob) {
    throw new RatchetInputError(
      'INVALID_BASELINE_PROVENANCE',
      `baseline.scannerBlob ${baseline.scannerBlob} does not match its source revision ${sourceScanner}`,
    );
  }
  const currentScanner = runGit(root, ['hash-object', SCANNER]).stdout.trim();
  if (currentScanner !== baseline.scannerBlob) {
    throw new RatchetInputError(
      'SCANNER_BASELINE_MISMATCH',
      `current ${SCANNER} blob ${currentScanner} differs from baseline ${baseline.scannerBlob}; regenerate explicitly`,
    );
  }
  const currentRevision = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  const distance = Number(runGit(root, ['rev-list', '--count', `${baseline.sourceRevision}..HEAD`]).stdout.trim());
  return { status: 'verified', currentRevision, distance };
}

function printResult(baseline, graph, result, provenance) {
  const headline = [
    `baselineEdges=${baseline.edges.length}`,
    `currentEdges=${graph.edges.length}`,
    `rawScannerEdges=${graph.rawEdges}`,
    `normalizedDuplicates=${graph.normalizedDuplicates}`,
    `added=${result.added.length}`,
    `removed=${result.removed.length}`,
    `cycles=${graph.cycles}`,
    `filesInCycles=${graph.filesInCycles}`,
    `baselineAuthority=${baseline.authority}`,
    `baselineRevision=${baseline.sourceRevision}`,
  ].join(' ');

  console.log(`${result.pass ? 'MODULE_BOUNDARY_RATCHET_PASS' : 'MODULE_BOUNDARY_RATCHET_FAIL'} ${headline}`);
  console.log(`P6_SCANNER_LIMITS ${graph.limitations.join('; ')}`);
  if (graph.normalizedDuplicates > 0) {
    console.log(`NORMALIZED_EDGE_COLLISIONS collapsed=${graph.normalizedDuplicates}`);
  }
  if (baseline.migrationAvailable) {
    console.log('BASELINE_SCHEMA_MIGRATION_AVAILABLE schemaVersion=1 target=2 command="node scripts/module-boundary-ratchet.mjs --write-baseline"');
  }
  if (provenance.status === 'verified') {
    console.log(
      `BASELINE_PROVENANCE_VERIFIED sourceRevision=${baseline.sourceRevision} `
      + `currentRevision=${provenance.currentRevision} commitsBehind=${provenance.distance}`,
    );
  } else {
    console.log(`BASELINE_PROVENANCE_UNVERIFIED reason=${provenance.status}`);
  }
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

function assertWriteTarget(root, target) {
  const targetRelative = relative(root, target);
  if (!targetRelative || targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) {
    throw new RatchetInputError('INVALID_BASELINE_TARGET', 'baseline write target must be inside the repository root');
  }
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new RatchetInputError('INVALID_BASELINE_TARGET', 'baseline write target must be a regular non-symlink file');
    }
  }
}

function inspectWritableSource(root) {
  if (!discoverGitRoot(root)) {
    throw new RatchetInputError('BASELINE_WRITE_REQUIRES_GIT', '--write-baseline requires a Git worktree');
  }
  const status = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (status) {
    throw new RatchetInputError(
      'BASELINE_WRITE_DIRTY_TREE',
      `--write-baseline requires a clean worktree before it writes; first dirty entry: ${status.split('\n')[0]}`,
    );
  }
  const sourceRevision = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  const sourceTree = runGit(root, ['rev-parse', 'HEAD:src']).stdout.trim();
  const scannerBlob = runGit(root, ['rev-parse', `HEAD:${SCANNER}`]).stdout.trim();
  return { sourceRevision, sourceTree, scannerBlob };
}

function atomicWriteJson(target, value) {
  const parent = dirname(target);
  const temporary = join(parent, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let fileDescriptor = null;
  try {
    fileDescriptor = openSync(temporary, 'wx', 0o644);
    writeFileSync(fileDescriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    renameSync(temporary, target);
    const directoryDescriptor = openSync(parent, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function printWriteDelta(baseline, graph, result) {
  console.log(
    `MODULE_BOUNDARY_BASELINE_REVIEW baselineEdges=${baseline.edges.length} currentEdges=${graph.edges.length} `
    + `added=${result.added.length} removed=${result.removed.length} cycles=${baseline.limits.cycles}->${graph.cycles} `
    + `filesInCycles=${baseline.limits.filesInCycles}->${graph.filesInCycles}`,
  );
  for (const edge of result.added) console.log(`ADDED ${edge}`);
  for (const edge of result.removed) console.log(`REMOVED ${edge}`);
}

function writeBaseline(options) {
  assertWriteTarget(options.root, options.baseline);
  const source = inspectWritableSource(options.root);
  const oldBaseline = validateBaseline(readJson(options.baseline, 'INVALID_BASELINE'));
  const graph = validateGraph(scanGraph(options.root));
  const result = compare(oldBaseline, graph);
  printWriteDelta(oldBaseline, graph, result);

  if (result.cycleGrowth || result.cycleMembershipGrowth) {
    console.error('MODULE_BOUNDARY_BASELINE_REFUSED CYCLE_GROWTH: ratchet policy forbids accepting cycle growth');
    return 1;
  }
  const accepted = new Set(options.acceptedEdges);
  const added = new Set(result.added);
  const missing = result.added.filter((edge) => !accepted.has(edge));
  const extra = options.acceptedEdges.filter((edge) => !added.has(edge));
  if (missing.length > 0 || extra.length > 0) {
    for (const edge of missing) console.error(`ACCEPTANCE_REQUIRED ${edge}`);
    for (const edge of extra) console.error(`UNEXPECTED_ACCEPTANCE ${edge}`);
    console.error(
      'MODULE_BOUNDARY_BASELINE_REFUSED EXACT_ACCEPTANCE_REQUIRED: '
      + 'rerun with one exact --accept-edge for every and only reviewed ADDED pair',
    );
    return 1;
  }

  const nextBaseline = {
    schemaVersion: 2,
    authority: 'integration',
    sourceRevision: source.sourceRevision,
    sourceTree: source.sourceTree,
    scanner: SCANNER,
    scannerProtocol: SCANNER_PROTOCOL,
    scannerBlob: source.scannerBlob,
    limits: {
      cycles: graph.cycles,
      filesInCycles: graph.filesInCycles,
    },
    edges: graph.edges,
  };
  atomicWriteJson(options.baseline, nextBaseline);
  console.log(
    `MODULE_BOUNDARY_BASELINE_WRITTEN path=${relative(options.root, options.baseline)} `
    + `sourceRevision=${source.sourceRevision} edges=${graph.edges.length}`,
  );
  return 0;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      process.exitCode = 0;
      return;
    }
    if (options.writeBaseline) {
      process.exitCode = writeBaseline(options);
      return;
    }
    const baseline = validateBaseline(readJson(options.baseline, 'INVALID_BASELINE'));
    const graphRaw = options.graph ? readJson(options.graph, 'INVALID_GRAPH') : scanGraph(options.root);
    const graph = validateGraph(graphRaw);
    const provenance = verifyBaselineProvenance(options.root, baseline);
    const result = compare(baseline, graph);
    printResult(baseline, graph, result, provenance);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    const code = error instanceof RatchetInputError ? error.code : 'UNEXPECTED_ERROR';
    console.error(`MODULE_BOUNDARY_RATCHET_ERROR ${code}: ${error.message}`);
    process.exitCode = 2;
  }
}

main();
