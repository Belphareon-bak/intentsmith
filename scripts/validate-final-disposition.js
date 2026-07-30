#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compareManifestToSource,
  EXPECTED_RECORD_COUNT,
  validateDiffManifest,
} from './final-disposition-manifest.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dispositionPath = path.join(
  repoRoot,
  'docs',
  'convergence',
  'FINAL-COMMIT-DISPOSITION.md',
);
const manifestPath = path.join(
  repoRoot,
  'docs',
  'convergence',
  'FINAL-COMMIT-DIFF-MANIFEST.json',
);

const repairedPathMappings = new Map([
  ['tests/TEST-INVENTORY.md', 'tests/registry.json'],
  ['tests/TEST-REGISTRY.md', 'docs/convergence/TEST-REGISTRY.md'],
  [
    'tests/packages/c3-backend -> tests/_legacy/packages/c3-backend',
    'tests/_legacy/packages/c3-backend.md',
  ],
]);
const DEFERRED_PREREQUISITES = new Set([
  'external-network',
  'gpu',
  'isolated-database',
  'ollama',
  'operator-fixture',
  'owned-server',
  'pinned-model',
  'sufficient-gpu-vram',
  'three-request-gpu-headroom',
]);

export function parseDispositionRows(markdown) {
  const rowPattern =
    /^\| `([^`]+)` \| `([^`]+)` \| `(KEEP|REBUILD|EXCLUDE|UNRESOLVED)` \| `([^`]*)` \| (.+) \|$/;
  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(rowPattern);
      if (!match) return null;
      return {
        status: match[1],
        displayPath: match[2],
        disposition: match[3],
        action: match[4],
        rationale: match[5],
      };
    })
    .filter(Boolean);
}

export function validateDispositionActions(rows) {
  const errors = [];
  for (const [index, row] of rows.entries()) {
    const label = `disposition row ${index + 1} (${row.displayPath})`;
    if (row.disposition === 'KEEP') {
      if (row.action !== 'REPLAY') errors.push(`${label}: KEEP action must be REPLAY`);
      continue;
    }
    if (row.disposition === 'EXCLUDE') {
      if (!['MOVE_OUTSIDE_PRODUCTION', 'REMOVE_FOLLOWUP'].includes(row.action)) {
        errors.push(`${label}: EXCLUDE action is invalid: ${row.action || '<empty>'}`);
      }
      continue;
    }
    if (row.disposition === 'UNRESOLVED') {
      if (row.action !== 'USER_DECISION') {
        errors.push(`${label}: UNRESOLVED action must be USER_DECISION`);
      }
      continue;
    }
    if (row.disposition !== 'REBUILD') continue;

    if (row.action === 'ACCEPTED' || row.action === 'REPAIRED') continue;
    const match = row.action.match(/^DEFERRED\(([^()]*)\)$/);
    if (!match) {
      errors.push(`${label}: REBUILD action is not a terminal D-018 state: ${row.action || '<empty>'}`);
      continue;
    }
    const prerequisites = match[1].split('+');
    if (
      match[1] === ''
      || prerequisites.some(value => !DEFERRED_PREREQUISITES.has(value))
      || new Set(prerequisites).size !== prerequisites.length
    ) {
      errors.push(
        `${label}: DEFERRED must name unique canonical concrete prerequisites`,
      );
    }
  }
  return errors;
}

export function validateAndResolve({
  manifest,
  dispositionRows,
  candidateRoot = repoRoot,
  sourceRepo = null,
}) {
  const errors = validateDiffManifest(manifest);
  errors.push(...validateDispositionActions(dispositionRows));
  if (sourceRepo) errors.push(...compareManifestToSource(manifest, sourceRepo));

  const records = Array.isArray(manifest?.records) ? manifest.records : [];
  const resolutions = [];
  if (dispositionRows.length !== EXPECTED_RECORD_COUNT) {
    errors.push(
      `disposition table has ${dispositionRows.length} records; expected ${EXPECTED_RECORD_COUNT}`,
    );
  }

  const limit = Math.max(records.length, dispositionRows.length);
  for (let index = 0; index < limit; index++) {
    const diff = records[index];
    const row = dispositionRows[index];
    if (!diff || !row) continue;

    const displayPath = diff.status === 'R100'
      ? `${diff.oldPath} -> ${diff.newPath}`
      : diff.newPath ?? diff.oldPath;
    if (row.status !== diff.status || row.displayPath !== displayPath) {
      errors.push(
        `record ${index + 1} mismatch: manifest=${diff.status} ${displayPath}; `
        + `table=${row.status} ${row.displayPath}`,
      );
      continue;
    }

    const mappedPath = repairedPathMappings.get(displayPath) ?? null;
    const candidatePath = mappedPath ?? diff.newPath ?? diff.oldPath;
    const candidateAbsolute = safeCandidatePath(candidateRoot, candidatePath);
    const candidateExists = pathExists(candidateAbsolute);

    if (
      diff.changeType === 'RENAME'
      && diff.oldPath !== candidatePath
      && pathExists(safeCandidatePath(candidateRoot, diff.oldPath))
    ) {
      errors.push(`renamed source path still exists: ${diff.oldPath}`);
    }

    const sourceBlob = diff.newBlob ?? diff.oldBlob;
    const sourceMode = diff.newMode ?? diff.oldMode;
    if (row.disposition === 'EXCLUDE') {
      if (candidateExists) {
        errors.push(`excluded path exists in candidate tree: ${candidatePath}`);
      }
      resolutions.push({
        ...row,
        sourcePath: diff.newPath ?? diff.oldPath,
        candidatePath,
        sourceBlob,
        sourceMode,
        candidateBlob: null,
        candidateMode: null,
        resolution: 'ABSENT',
      });
      continue;
    }

    if (row.disposition === 'UNRESOLVED') {
      errors.push(`unresolved disposition remains: ${displayPath}`);
    }

    if (diff.changeType === 'DELETE') {
      if (candidateExists) {
        errors.push(`deleted source path remains in candidate tree: ${candidatePath}`);
      }
      resolutions.push({
        ...row,
        sourcePath: diff.oldPath,
        candidatePath,
        sourceBlob,
        sourceMode,
        candidateBlob: null,
        candidateMode: null,
        resolution: candidateExists ? 'NOT_DELETED' : 'EXACT_DELETE',
      });
      continue;
    }

    if (!candidateExists) {
      errors.push(
        `${row.disposition.toLowerCase()} path is unresolved in candidate tree: `
        + `${displayPath}${mappedPath ? ` (mapped to ${mappedPath})` : ''}`,
      );
      resolutions.push({
        ...row,
        sourcePath: diff.newPath,
        candidatePath,
        sourceBlob,
        sourceMode,
        candidateBlob: null,
        candidateMode: null,
        resolution: 'MISSING',
      });
      continue;
    }

    const candidate = candidateObject(candidateAbsolute);
    const resolution = mappedPath
      ? 'MAPPED_REPAIR'
      : sourceBlob === candidate.blob && sourceMode === candidate.mode
        ? 'EXACT'
        : 'MODIFIED';
    validateTerminalResolution(row, resolution, displayPath, errors);
    resolutions.push({
      ...row,
      sourcePath: diff.newPath,
      candidatePath,
      sourceBlob,
      sourceMode,
      candidateBlob: candidate.blob,
      candidateMode: candidate.mode,
      resolution,
    });
  }

  validateTrackedSymlinks(candidateRoot, errors);
  return { errors, resolutions };
}

export function countBy(values, key) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const label = value[key];
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function buildValidationReport({
  manifest,
  dispositionRows,
  candidateRoot = repoRoot,
  sourceRepo = null,
}) {
  const { errors, resolutions } = validateAndResolve({
    manifest,
    dispositionRows,
    candidateRoot,
    sourceRepo,
  });
  return {
    schemaVersion: 2,
    sourceRepository: manifest?.sourceRepository ?? null,
    sourceRange: manifest?.sourceRange ?? null,
    sourceManifest: {
      path: 'docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json',
      schemaVersion: manifest?.schemaVersion ?? null,
      recordsSha256: manifest?.recordsSha256 ?? null,
      recordCount: manifest?.recordCount ?? null,
      changeCounts: manifest?.changeCounts ?? null,
      liveSourceCrossCheck: sourceRepo ? 'PASS' : 'NOT_REQUESTED',
    },
    records: Array.isArray(manifest?.records) ? manifest.records.length : 0,
    dispositionCounts: countBy(resolutions, 'disposition'),
    terminalCounts: countBy(
      resolutions.filter(item => item.disposition === 'REBUILD'),
      'action',
    ),
    resolutionCounts: countBy(resolutions, 'resolution'),
    errors,
    paths: resolutions,
  };
}

function validateTerminalResolution(row, resolution, displayPath, errors) {
  if (row.disposition !== 'REBUILD') return;
  if (row.action === 'REPAIRED' && resolution === 'EXACT') {
    errors.push(`REBUILD/REPAIRED path is byte-and-mode exact, not repaired: ${displayPath}`);
  }
  if (row.action === 'ACCEPTED' && resolution !== 'EXACT') {
    errors.push(`REBUILD/ACCEPTED path is not byte-and-mode exact: ${displayPath}`);
  }
}

function safeCandidatePath(candidateRoot, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(`unsafe candidate path: ${relativePath}`);
  }
  const absolute = path.resolve(candidateRoot, relativePath);
  const relative = path.relative(candidateRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`candidate path escapes repository: ${relativePath}`);
  }
  return absolute;
}

function pathExists(candidate) {
  try {
    lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function candidateObject(absolutePath) {
  const info = lstatSync(absolutePath);
  if (info.isSymbolicLink()) {
    const bytes = Buffer.from(readlinkSync(absolutePath));
    return { blob: hashGitBlob(bytes), mode: '120000' };
  }
  if (!info.isFile()) throw new Error(`candidate path is not a file: ${absolutePath}`);
  const bytes = readFileSync(absolutePath);
  return {
    blob: hashGitBlob(bytes),
    mode: (info.mode & 0o111) === 0 ? '100644' : '100755',
  };
}

function hashGitBlob(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex');
}

function validateTrackedSymlinks(candidateRoot, errors) {
  const entries = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd: candidateRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^(\d+) [0-9a-f]+ \d+\t(.+)$/s);
    if (!match || match[1] !== '120000') continue;
    const relativePath = match[2];
    const absolutePath = path.join(candidateRoot, relativePath);
    if (!pathExists(absolutePath)) {
      errors.push(`tracked symlink is missing from the worktree: ${relativePath}`);
      continue;
    }
    const target = readlinkSync(absolutePath);
    if (path.isAbsolute(target)) {
      errors.push(`tracked symlink has an absolute target: ${relativePath} -> ${target}`);
    }
  }
}

function parseCliArgs(argv) {
  const options = {
    json: false,
    reportPath: null,
    sourceRepo: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--report') {
      if (!argv[index + 1]) throw new Error('--report requires a path');
      options.reportPath = path.resolve(repoRoot, argv[++index]);
      continue;
    }
    if (arg.startsWith('--source-repo=')) {
      options.sourceRepo = path.resolve(arg.slice('--source-repo='.length));
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function ensurePrivateReportPath(reportPath) {
  const privateRoot = path.join(repoRoot, '.intentsmith-artifacts');
  const relative = path.relative(privateRoot, reportPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--report must be below .intentsmith-artifacts/');
  }

  let current = privateRoot;
  const parent = path.dirname(reportPath);
  const parentRelative = path.relative(privateRoot, parent);
  for (const component of parentRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (pathExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`report path contains a symlink: ${current}`);
    }
  }
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
}

function writePrivateReport(reportPath, report) {
  ensurePrivateReportPath(reportPath);
  const fd = openSync(reportPath, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(fd);
  }
  chmodSync(reportPath, 0o600);
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dispositionRows = parseDispositionRows(readFileSync(dispositionPath, 'utf8'));
  const report = buildValidationReport({
    manifest,
    dispositionRows,
    sourceRepo: options.sourceRepo,
  });

  if (options.reportPath) writePrivateReport(options.reportPath, report);
  if (options.json) {
    console.log(JSON.stringify(report));
  } else if (report.errors.length === 0) {
    console.log(
      `Disposition valid: ${report.records} records; `
      + `manifest=${report.sourceManifest.recordsSha256}; `
      + `dispositions=${JSON.stringify(report.dispositionCounts)}; `
      + `terminals=${JSON.stringify(report.terminalCounts)}; `
      + `resolutions=${JSON.stringify(report.resolutionCounts)}`,
    );
    if (options.sourceRepo) console.log(`C3 source cross-check: PASS (${options.sourceRepo})`);
    if (options.reportPath) {
      console.log(`Private resolution report: ${path.relative(repoRoot, options.reportPath)}`);
    }
  } else {
    for (const error of report.errors) console.error(`ERROR: ${error}`);
    console.error(`Disposition validation failed with ${report.errors.length} error(s).`);
  }

  if (report.errors.length > 0) process.exitCode = 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
