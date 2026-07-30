#!/usr/bin/env node

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dispositionPath = path.join(
  repoRoot,
  'docs',
  'convergence',
  'FINAL-COMMIT-DISPOSITION.md',
);
const parentRef = 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f';
const sourceRef = 'ffd21cf119865259ea1847af989acb24916bebe3';
const expectedRecords = 225;

const repairedPathMappings = new Map([
  ['tests/TEST-INVENTORY.md', 'tests/registry.json'],
  ['tests/TEST-REGISTRY.md', 'docs/convergence/TEST-REGISTRY.md'],
  [
    'tests/packages/c3-backend -> tests/_legacy/packages/c3-backend',
    'tests/_legacy/packages/c3-backend.md',
  ],
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parseDiffRecords() {
  const fields = git([
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    `${parentRef}..${sourceRef}`,
  ]).split('\0');
  fields.pop();

  const records = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (/^[RC]\d+$/.test(status)) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      records.push({
        status,
        oldPath,
        targetPath: newPath,
        displayPath: `${oldPath} -> ${newPath}`,
      });
    } else {
      const targetPath = fields[index++];
      records.push({ status, oldPath: null, targetPath, displayPath: targetPath });
    }
  }
  return records;
}

function parseDispositionRows(markdown) {
  const rowPattern =
    /^\| `([^`]+)` \| `([^`]+)` \| `(KEEP|REBUILD|EXCLUDE|UNRESOLVED)` \| `([^`]+)` \| (.+) \|$/;
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

function pathExists(candidate) {
  try {
    lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function sourceBlob(targetPath) {
  return git(['rev-parse', `${sourceRef}:${targetPath}`]).trim();
}

function currentBlob(relativePath) {
  return git(['hash-object', '--no-filters', '--', relativePath]).trim();
}

function validateTrackedSymlinks(errors) {
  const entries = git(['ls-files', '-s', '-z']).split('\0').filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^(\d+) [0-9a-f]+ \d+\t(.+)$/s);
    if (!match || match[1] !== '120000') continue;
    const relativePath = match[2];
    const absolutePath = path.join(repoRoot, relativePath);
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

function validateAndResolve(diffRecords, dispositionRows) {
  const errors = [];
  const resolutions = [];

  if (diffRecords.length !== expectedRecords) {
    errors.push(`Git diff has ${diffRecords.length} records; expected ${expectedRecords}`);
  }
  if (dispositionRows.length !== expectedRecords) {
    errors.push(
      `disposition table has ${dispositionRows.length} records; expected ${expectedRecords}`,
    );
  }

  const limit = Math.max(diffRecords.length, dispositionRows.length);
  for (let index = 0; index < limit; index++) {
    const diff = diffRecords[index];
    const row = dispositionRows[index];
    if (!diff || !row) continue;
    if (row.status !== diff.status || row.displayPath !== diff.displayPath) {
      errors.push(
        `record ${index + 1} mismatch: Git=${diff.status} ${diff.displayPath}; ` +
        `table=${row.status} ${row.displayPath}`,
      );
      continue;
    }

    const mappedPath = repairedPathMappings.get(diff.displayPath) ?? null;
    const candidatePath = mappedPath ?? diff.targetPath;
    const candidateAbsolute = path.join(repoRoot, candidatePath);
    const candidateExists = pathExists(candidateAbsolute);

    if (diff.oldPath && pathExists(path.join(repoRoot, diff.oldPath))) {
      errors.push(`renamed source path still exists: ${diff.oldPath}`);
    }

    if (row.disposition === 'EXCLUDE') {
      if (candidateExists) {
        errors.push(`excluded path exists in candidate tree: ${candidatePath}`);
      }
      resolutions.push({
        ...row,
        sourcePath: diff.targetPath,
        candidatePath,
        sourceBlob: sourceBlob(diff.targetPath),
        candidateBlob: null,
        resolution: 'ABSENT',
      });
      continue;
    }

    if (row.disposition === 'UNRESOLVED') {
      errors.push(`unresolved disposition remains: ${diff.displayPath}`);
      resolutions.push({
        ...row,
        sourcePath: diff.targetPath,
        candidatePath,
        sourceBlob: sourceBlob(diff.targetPath),
        candidateBlob: candidateExists ? currentBlob(candidatePath) : null,
        resolution: 'UNRESOLVED',
      });
      continue;
    }

    if (!candidateExists) {
      errors.push(
        `${row.disposition.toLowerCase()} path is unresolved in candidate tree: ` +
        `${diff.displayPath}${mappedPath ? ` (mapped to ${mappedPath})` : ''}`,
      );
      resolutions.push({
        ...row,
        sourcePath: diff.targetPath,
        candidatePath,
        sourceBlob: sourceBlob(diff.targetPath),
        candidateBlob: null,
        resolution: 'MISSING',
      });
      continue;
    }

    const originalBlob = sourceBlob(diff.targetPath);
    const candidateBlob = currentBlob(candidatePath);
    resolutions.push({
      ...row,
      sourcePath: diff.targetPath,
      candidatePath,
      sourceBlob: originalBlob,
      candidateBlob,
      resolution: mappedPath
        ? 'MAPPED_REPAIR'
        : originalBlob === candidateBlob
          ? 'EXACT'
          : 'MODIFIED',
    });
  }

  validateTrackedSymlinks(errors);
  return { errors, resolutions };
}

function countBy(values, key) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const label = value[key];
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function parseReportPath(argv) {
  const index = argv.indexOf('--report');
  if (index === -1) return null;
  if (!argv[index + 1]) throw new Error('--report requires a path');
  return path.resolve(repoRoot, argv[index + 1]);
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
  const markdown = readFileSync(dispositionPath, 'utf8');
  const diffRecords = parseDiffRecords();
  const dispositionRows = parseDispositionRows(markdown);
  const { errors, resolutions } = validateAndResolve(diffRecords, dispositionRows);

  const report = {
    schemaVersion: 1,
    sourceRange: `${parentRef}..${sourceRef}`,
    records: diffRecords.length,
    dispositionCounts: countBy(resolutions, 'disposition'),
    resolutionCounts: countBy(resolutions, 'resolution'),
    errors,
    paths: resolutions,
  };

  const reportPath = parseReportPath(process.argv.slice(2));
  if (reportPath) writePrivateReport(reportPath, report);

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`Disposition validation failed with ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Disposition valid: ${diffRecords.length} records; ` +
    `dispositions=${JSON.stringify(report.dispositionCounts)}; ` +
    `resolutions=${JSON.stringify(report.resolutionCounts)}`,
  );
  if (reportPath) {
    console.log(`Private resolution report: ${path.relative(repoRoot, reportPath)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
