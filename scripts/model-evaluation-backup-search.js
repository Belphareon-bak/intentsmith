#!/usr/bin/env node

// Reproducible, read-only search for an exact historical SQLite backup.
// Roots are explicit, symlinks are never followed, and every suffix-selected
// candidate is recorded with its relative path, SQLite header status and SHA.

import { createHash } from 'node:crypto';
import {
  createReadStream,
  openSync,
  closeSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');
const SQLITE_SUFFIXES = new Set(['.db', '.db3', '.sqlite', '.sqlite3']);

function parseArgs(argv) {
  const roots = [];
  let claimedSha256 = null;
  let outPath = null;
  for (const arg of argv) {
    if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      const separator = value.indexOf(':');
      if (separator < 1 || separator === value.length - 1) {
        throw new Error('--root must use id:/absolute/path');
      }
      const id = value.slice(0, separator);
      const path = resolve(value.slice(separator + 1));
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || roots.some(root => root.id === id)) {
        throw new Error(`invalid or duplicate root id: ${id}`);
      }
      roots.push(Object.freeze({ id, path }));
    } else if (arg.startsWith('--claimed-sha256=')) {
      claimedSha256 = arg.slice('--claimed-sha256='.length).toLowerCase();
    } else if (arg.startsWith('--out=')) {
      outPath = resolve(arg.slice('--out='.length));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (roots.length === 0) throw new Error('at least one --root=id:/absolute/path is required');
  if (!/^[a-f0-9]{64}$/.test(claimedSha256 || '')) {
    throw new Error('--claimed-sha256 must be a lowercase SHA-256');
  }
  return Object.freeze({ roots: Object.freeze(roots), claimedSha256, outPath });
}

function candidatePaths(rootPath) {
  const paths = [];
  const skippedSymlinks = [];
  const errors = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    } catch (error) {
      errors.push({ path: relative(rootPath, directory), code: error.code || 'READ_FAILED' });
      return;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks.push(relative(rootPath, path));
      } else if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && SQLITE_SUFFIXES.has(extname(entry.name).toLowerCase())) {
        paths.push(path);
      }
    }
  };
  visit(rootPath);
  return Object.freeze({ paths, skippedSymlinks, errors });
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function hasSqliteHeader(path) {
  const buffer = Buffer.alloc(SQLITE_HEADER.length);
  const fd = openSync(path, 'r');
  try {
    return readSync(fd, buffer, 0, buffer.length, 0) === buffer.length
      && buffer.equals(SQLITE_HEADER);
  } finally {
    closeSync(fd);
  }
}

async function describeCandidate(root, path) {
  const before = statSync(path);
  const sqliteHeader = hasSqliteHeader(path);
  const sha256 = await sha256File(path);
  const after = statSync(path);
  const stable = before.size === after.size && before.mtimeMs === after.mtimeMs;
  if (!stable) throw new Error(`candidate changed while hashing: ${path}`);
  return Object.freeze({
    rootId: root.id,
    relativePath: relative(root.path, path),
    bytes: before.size,
    modifiedAt: before.mtime.toISOString(),
    sqliteHeader,
    sha256,
  });
}

function sourceRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5_000 });
  return Object.freeze({
    exitCode: Number.isInteger(result.status) ? result.status : null,
    value: result.status === 0 ? result.stdout.trim() : null,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const candidates = [];
  const roots = [];
  for (const root of options.roots) {
    const selection = candidatePaths(root.path);
    roots.push(Object.freeze({
      id: root.id,
      path: root.path,
      candidateCount: selection.paths.length,
      skippedSymlinkCount: selection.skippedSymlinks.length,
      traversalErrors: selection.errors,
    }));
    for (const path of selection.paths) candidates.push(await describeCandidate(root, path));
  }
  candidates.sort((a, b) => (
    a.rootId.localeCompare(b.rootId, 'en')
      || a.relativePath.localeCompare(b.relativePath, 'en')
  ));
  const matches = candidates.filter(candidate => candidate.sha256 === options.claimedSha256);
  const manifest = {
    schemaVersion: 'intentsmith-model-evaluation-backup-search-v1',
    startedAt,
    completedAt: new Date().toISOString(),
    sourceRevision: sourceRevision(),
    selection: {
      regularFilesOnly: true,
      followSymlinks: false,
      suffixes: [...SQLITE_SUFFIXES].sort(),
      hashAlgorithm: 'sha256',
      sqliteHeaderChecked: true,
    },
    roots,
    claimedSha256: options.claimedSha256,
    candidateCount: candidates.length,
    sqliteHeaderCount: candidates.filter(candidate => candidate.sqliteHeader).length,
    matches: matches.map(candidate => ({
      rootId: candidate.rootId,
      relativePath: candidate.relativePath,
      sha256: candidate.sha256,
    })),
    result: matches.length === 0 ? 'NOT_FOUND_NOT_PROVEN' : 'MATCH_FOUND',
    candidates,
  };
  const rendered = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.outPath) {
    writeFileSync(options.outPath, rendered, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } else {
    process.stdout.write(rendered);
  }
}

main().catch(error => {
  process.stderr.write(`MODEL_EVALUATION_BACKUP_SEARCH_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
