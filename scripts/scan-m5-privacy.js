#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanM5TrackedTree,
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

try {
  if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') {
    throw new Error('dirty-worktree');
  }
  const candidateRevision = git(['rev-parse', 'HEAD']).trim();
  const paths = git(['ls-files', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const treeScan = scanM5TrackedTree({
    candidateRevision,
    paths,
    readFile: relativePath => fs.readFileSync(path.join(root, relativePath)),
  });
  const incident = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/convergence/PRIVACY-INCIDENT.json'),
    'utf8',
  ));
  const historyReachability = verifyM5PrivacyHistoryReachability(incident, objectExists);
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
