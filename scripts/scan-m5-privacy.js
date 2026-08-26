#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanM5TrackedTree,
  isM5PrivacyContentScanPath,
  verifyM5PrivacyHistoryReachability,
} from '../src/security/privacy-scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function objectExists(objectId) {
  const result = spawnSync('git', ['cat-file', '-e', objectId], {
    cwd: root,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function treeEntries(revision) {
  const raw = git(['ls-tree', '-r', '-z', '--full-tree', revision], { encoding: 'buffer' });
  return raw.toString('utf8').split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('invalid-tree-entry');
    const [mode, type, objectId] = entry.slice(0, separator).split(' ');
    const relativePath = entry.slice(separator + 1);
    if (!mode || !type || !/^[a-f0-9]{40}$/.test(objectId || '') || !relativePath) {
      throw new Error('invalid-tree-entry');
    }
    return { mode, type, objectId, relativePath };
  });
}

function readExactBlobs(entries) {
  const objectIds = [...new Set(entries.map(entry => entry.objectId))];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: Buffer.from(`${objectIds.join('\n')}\n`, 'utf8'),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.stderr.length !== 0) {
    throw new Error('exact-head-blob-read-failed');
  }
  const blobs = new Map();
  let offset = 0;
  for (const requestedId of objectIds) {
    const lineEnd = result.stdout.indexOf(10, offset);
    if (lineEnd < 0) throw new Error('invalid-cat-file-header');
    const header = result.stdout.subarray(offset, lineEnd).toString('utf8').split(' ');
    const [actualId, type, rawSize] = header;
    const size = Number(rawSize);
    if (actualId !== requestedId || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('invalid-cat-file-header');
    }
    const contentStart = lineEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 10) {
      throw new Error('invalid-cat-file-payload');
    }
    blobs.set(requestedId, Buffer.from(result.stdout.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== result.stdout.length) throw new Error('unexpected-cat-file-output');
  return blobs;
}

try {
  if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') {
    throw new Error('dirty-worktree');
  }
  const candidateRevision = git(['rev-parse', 'HEAD']).trim();
  const entries = treeEntries(candidateRevision);
  const paths = entries.map(entry => entry.relativePath);
  const incidentPath = 'docs/convergence/PRIVACY-INCIDENT.json';
  const requiredEntries = entries.filter(entry => (
    isM5PrivacyContentScanPath(entry.relativePath) || entry.relativePath === incidentPath
  ));
  const blobs = readExactBlobs(requiredEntries);
  const entryByPath = new Map(entries.map(entry => [entry.relativePath, entry]));
  const treeScan = scanM5TrackedTree({
    candidateRevision,
    paths,
    readFile: relativePath => {
      const entry = entryByPath.get(relativePath);
      const bytes = entry && blobs.get(entry.objectId);
      if (!bytes) throw new Error('exact-head-blob-unavailable');
      return bytes;
    },
  });
  const incidentEntry = entryByPath.get(incidentPath);
  const incidentBytes = incidentEntry && blobs.get(incidentEntry.objectId);
  if (!incidentBytes) throw new Error('incident-exact-head-blob-unavailable');
  const incident = JSON.parse(incidentBytes.toString('utf8'));
  const historyReachability = verifyM5PrivacyHistoryReachability(incident, objectExists);
  if (git(['rev-parse', 'HEAD']).trim() !== candidateRevision) {
    throw new Error('candidate-head-changed-during-scan');
  }
  if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') {
    throw new Error('dirty-worktree-after-scan');
  }
  const report = {
    contract: 'M5PrivacyScanEvidence',
    version: 1,
    treeScan,
    historyReachability,
    verdict: treeScan.verdict === 'PASS' && historyReachability.allReachable
      ? 'PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE'
      : 'FAIL',
    secretValuesRecorded: false,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = treeScan.verdict === 'PASS' ? 0 : 1;
} catch {
  process.stderr.write('M5 privacy scan failed without emitting content or secret values.\n');
  process.exitCode = 2;
}
