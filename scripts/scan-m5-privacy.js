#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function historyDispositionArgument(argv) {
  const prefix = '--history-disposition=';
  const matches = argv.filter(argument => argument.startsWith(prefix));
  if (matches.length > 1 || argv.some(argument => !argument.startsWith(prefix))) {
    throw new Error('invalid-history-disposition-argument');
  }
  if (matches.length === 0 || matches[0] === `${prefix}none`) return null;
  const value = matches[0].slice(prefix.length);
  if (!['retain_and_rotate', 'rewrite_and_rotate', 'new_root_and_rotate'].includes(value)) {
    throw new Error('invalid-history-disposition-argument');
  }
  return value;
}

function declaredRefCensus() {
  const lines = git(['for-each-ref', '--format=%(refname) %(objectname)'])
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf(' ');
      if (separator < 1) throw new Error('invalid-declared-ref');
      const refName = line.slice(0, separator);
      const objectId = line.slice(separator + 1);
      if (!refName.startsWith('refs/') || !/^[a-f0-9]{40}$/.test(objectId)) {
        throw new Error('invalid-declared-ref');
      }
      return { refName, objectId };
    });
  const head = git(['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('invalid-head-ref');
  lines.push({ refName: 'HEAD', objectId: head });
  lines.sort((left, right) => Buffer.compare(
    Buffer.from(`${left.refName}\0${left.objectId}`, 'utf8'),
    Buffer.from(`${right.refName}\0${right.objectId}`, 'utf8'),
  ));
  const digest = createHash('sha256')
    .update(JSON.stringify(lines), 'utf8')
    .digest('hex');
  return Object.freeze({
    refs: Object.freeze(lines),
    count: lines.length,
    digest: `sha256:${digest}`,
  });
}

function objectsReachableFrom(census) {
  const tips = [...new Set(census.refs.map(ref => ref.objectId))].sort();
  const result = spawnSync('git', ['rev-list', '--objects', '--no-object-names', '--stdin'], {
    cwd: root,
    input: Buffer.from(`${tips.join('\n')}\n`, 'utf8'),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.stderr.length !== 0) {
    throw new Error('declared-ref-reachability-failed');
  }
  const reachable = new Set(result.stdout.toString('utf8').split('\n').filter(Boolean));
  if ([...reachable].some(objectId => !/^[a-f0-9]{40}$/.test(objectId))) {
    throw new Error('invalid-reachable-object');
  }
  return reachable;
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
  const declaredDisposition = historyDispositionArgument(process.argv.slice(2));
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
  const refCensus = declaredRefCensus();
  const reachableObjects = objectsReachableFrom(refCensus);
  const historyReachability = verifyM5PrivacyHistoryReachability(incident, {
    isReachable: objectId => reachableObjects.has(objectId),
    declaredRefCount: refCensus.count,
    declaredRefDigest: refCensus.digest,
    declaredDisposition,
  });
  const finalRefCensus = declaredRefCensus();
  if (finalRefCensus.count !== refCensus.count || finalRefCensus.digest !== refCensus.digest) {
    throw new Error('declared-refs-changed-during-scan');
  }
  if (git(['rev-parse', 'HEAD']).trim() !== candidateRevision) {
    throw new Error('candidate-head-changed-during-scan');
  }
  if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') {
    throw new Error('dirty-worktree-after-scan');
  }
  const historyMismatch = historyReachability.verdict === 'HISTORY_DISPOSITION_MISMATCH';
  let verdict = 'FAIL';
  if (treeScan.verdict === 'PASS' && !historyMismatch) {
    if (historyReachability.verdict === 'HISTORY_REMEDIATION_REQUIRED') {
      verdict = 'PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED';
    } else if (historyReachability.verdict === 'HISTORY_REMOVED_RECEIPT_PENDING') {
      verdict = 'PASS_CURRENT_TREE_HISTORY_REMOVED_RECEIPT_PENDING';
    } else if (historyReachability.verdict === 'HISTORY_RETAINED_AS_DECLARED') {
      verdict = 'PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED';
    } else if (historyReachability.verdict === 'HISTORY_REMOVED_AS_DECLARED') {
      verdict = 'PASS_CURRENT_TREE_HISTORY_REMOVED_AS_DECLARED';
    }
  }
  const report = {
    contract: 'M5PrivacyScanEvidence',
    version: 2,
    treeScan,
    historyReachability,
    verdict,
    secretValuesRecorded: false,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = treeScan.verdict === 'PASS' && !historyMismatch ? 0 : 1;
} catch {
  process.stderr.write('M5 privacy scan failed without emitting content or secret values.\n');
  process.exitCode = 2;
}
